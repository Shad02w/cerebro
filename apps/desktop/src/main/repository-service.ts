import { execFile } from 'node:child_process'
import type { RepositoryProvider, ProviderIssue, RepositoryPullRequests } from '../shared/types'
import { fetchPullRequestsByBranch, type GraphQlResponse } from './github-prs'

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message)
  }
}

export async function githubJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers
    },
    signal: AbortSignal.timeout(20_000)
  })
  const body = (await response.json()) as T & {
    message?: string
    errors?: { type?: string; message?: string }[]
  }
  const rateLimited =
    response.status === 429 ||
    response.headers.get('x-ratelimit-remaining') === '0' ||
    body.errors?.some((error) => error.type === 'RATE_LIMITED')
  if (!response.ok || rateLimited) {
    const retrySeconds = Number(response.headers.get('retry-after'))
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now()
    throw new ProviderError(
      body.message ||
        (rateLimited
          ? 'GitHub rate limit reached.'
          : `GitHub request failed (${response.status}).`),
      response.status,
      rateLimited ? Math.max(60_000, retrySeconds * 1000, reset) : undefined
    )
  }
  return body
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv }
) => Promise<string>
export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: {
          ...process.env,
          PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin`,
          GIT_TERMINAL_PROMPT: '0',
          GH_PROMPT_DISABLED: '1',
          ...options.env
        },
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        // Never expose execFile's command line (which can contain credential material).
        if (error)
          reject(
            new Error(
              error.code === 'ENOENT'
                ? `${command} is not installed or available on PATH.`
                : stderr.trim() || `${command} failed.`
            )
          )
        else resolve(stdout.trim())
      }
    )
    child.stdin?.on('error', () => {
      /* Process may exit before consuming stdin. */
    })
    child.stdin?.end(options.input)
  })

type Dependencies = {
  getToken: (forceRefresh?: boolean) => Promise<string | null>
  apiUrl?: string
  run?: CommandRunner
}

type Provider = {
  name: RepositoryProvider
  pullRequests: (owner: string, repo: string) => Promise<RepositoryPullRequests['byBranch']>
  branches: (owner: string, repo: string, localPath: string) => Promise<string[]>
}

/** Capability-based fallback. A successful empty result is authoritative. */
export class RepositoryService {
  private readonly run: CommandRunner
  private readonly apiUrl: string
  private readonly providers: Provider[]
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly dependencies: Dependencies) {
    this.run = dependencies.run ?? runCommand
    this.apiUrl = dependencies.apiUrl ?? 'https://api.github.com'
    this.providers = [
      {
        name: 'github-app',
        pullRequests: (owner, repo) =>
          fetchPullRequestsByBranch(owner, repo, (body) =>
            this.appRequest<GraphQlResponse>('/graphql', {
              method: 'POST',
              body: JSON.stringify(body)
            })
          ),
        branches: async (owner, repo) => {
          const names: string[] = []
          for (let page = 1; ; page++) {
            const branches = await this.appRequest<Array<{ name: string }>>(
              `/repos/${owner}/${repo}/branches?per_page=100&page=${page}`
            )
            names.push(...branches.map((branch) => branch.name))
            if (branches.length < 100) return names
          }
        }
      },
      {
        name: 'gh',
        pullRequests: (owner, repo) =>
          fetchPullRequestsByBranch(
            owner,
            repo,
            async (body) =>
              JSON.parse(
                await this.run(
                  'gh',
                  ['api', '--hostname', 'github.com', 'graphql', '--input', '-'],
                  { input: JSON.stringify(body) }
                )
              ) as GraphQlResponse
          ),
        branches: async (owner, repo) =>
          (
            await this.run('gh', [
              'api',
              '--hostname',
              'github.com',
              '--paginate',
              `repos/${owner}/${repo}/branches?per_page=100`,
              '--jq',
              '.[].name'
            ])
          )
            .split('\n')
            .filter(Boolean)
      },
      {
        name: 'git',
        pullRequests: async () => {
          throw new Error(
            'Git cannot read pull request or review status. Connect GitHub or sign in with gh.'
          )
        },
        branches: async (_owner, _repo, localPath) => {
          try {
            const output = await this.run('git', ['ls-remote', '--heads', 'origin'], {
              cwd: localPath
            })
            return output
              .split('\n')
              .map((line) => line.match(/\srefs\/heads\/(.+)$/)?.[1])
              .filter((name): name is string => !!name)
          } catch {
            const output = await this.run(
              'git',
              ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin'],
              { cwd: localPath }
            )
            const names = output
              .split('\n')
              .filter((name) => name && name !== 'refs/remotes/origin/HEAD')
              .map((name) => name.replace(/^refs\/(?:heads|remotes\/origin)\//, ''))
            if (!names.length) throw new Error('Git could not read remote or local branches.')
            return names
          }
        }
      }
    ]
  }

  private async appRequest<T>(path: string, init?: RequestInit): Promise<T> {
    let token = await this.dependencies.getToken()
    if (!token) throw new Error('GitHub App is not connected.')
    try {
      return await githubJson<T>(`${this.apiUrl}${path}`, token, init)
    } catch (error) {
      if (!(error instanceof ProviderError) || error.status !== 401) throw error
      token = await this.dependencies.getToken(true)
      if (!token) throw error
      return githubJson<T>(`${this.apiUrl}${path}`, token, init)
    }
  }

  private async limited<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 4) await new Promise<void>((resolve) => this.queue.push(resolve))
    else this.active++
    try {
      return await operation()
    } finally {
      const next = this.queue.shift()
      if (next) next()
      else this.active--
    }
  }

  private async choose<T>(operation: (provider: Provider) => Promise<T>): Promise<{
    data?: T
    provider: RepositoryProvider
    issues: ProviderIssue[]
    retryAfterMs?: number
  }> {
    const issues: ProviderIssue[] = []
    for (const provider of this.providers) {
      try {
        return { data: await operation(provider), provider: provider.name, issues }
      } catch (error) {
        issues.push({
          provider: provider.name,
          message: error instanceof Error ? error.message : 'Provider failed.'
        })
        if (error instanceof ProviderError && error.retryAfterMs)
          return { provider: provider.name, issues, retryAfterMs: error.retryAfterMs }
      }
    }
    return { provider: 'git', issues }
  }

  pullRequests(owner: string, repo: string): Promise<RepositoryPullRequests> {
    return this.limited(async () => {
      const result = await this.choose((provider) => provider.pullRequests(owner, repo))
      return {
        provider: result.provider,
        available: result.data !== undefined,
        byBranch: result.data ?? {},
        checkedAt: new Date().toISOString(),
        issues: result.issues,
        retryAfterMs: result.retryAfterMs
      }
    })
  }

  branches(owner: string, repo: string, localPath: string): Promise<string[]> {
    return this.limited(async () => {
      const result = await this.choose((provider) => provider.branches(owner, repo, localPath))
      if (!result.data)
        throw new Error(
          result.issues.map((issue) => `${issue.provider}: ${issue.message}`).join('\n')
        )
      return [...new Set(result.data)].sort((a, b) => a.localeCompare(b))
    })
  }

  /** Only the network operation is retried; worktree/database mutations run once. */
  async git(args: string[], cwd?: string): Promise<string> {
    const configs = (entries: Array<[string, string]>): NodeJS.ProcessEnv =>
      Object.fromEntries([
        ['GIT_CONFIG_COUNT', String(entries.length)],
        ...entries.flatMap(([key, value], index) => [
          [`GIT_CONFIG_KEY_${index}`, key],
          [`GIT_CONFIG_VALUE_${index}`, value]
        ])
      ])
    const rewrite: Array<[string, string]> = [
      ['url.https://github.com/.insteadOf', 'git@github.com:'],
      ['url.https://github.com/.insteadOf', 'ssh://git@github.com/']
    ]
    // Credentials stay in the child environment, never in URLs, argv or .git/config.
    try {
      const token = await this.dependencies.getToken()
      if (token) {
        try {
          return await this.run('git', args, {
            cwd,
            env: configs([
              ...rewrite,
              ['credential.helper', ''],
              [
                'http.https://github.com/.extraheader',
                `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
              ]
            ])
          })
        } catch {
          /* Try the next credential provider. */
        }
      }
    } catch {
      /* Token renewal failed; use the user's other credentials. */
    }
    try {
      await this.run('gh', ['auth', 'status', '--hostname', 'github.com'])
      return await this.run('git', args, {
        cwd,
        env: configs([
          ...rewrite,
          ['credential.helper', ''],
          ['credential.https://github.com.helper', '!gh auth git-credential']
        ])
      })
    } catch {
      /* Fall back to system Git configuration (including SSH). */
    }
    return this.run('git', args, { cwd })
  }
}
