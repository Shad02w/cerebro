import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 5 * 60 * 1000

const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0'
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: gitEnv
    })
    return stdout.trim()
  } catch (error) {
    const err = error as { stderr?: string; message?: string; code?: string }
    if (err.code === 'ENOENT') {
      throw new Error('Git is not installed or not available on PATH.')
    }
    const detail = (err.stderr || err.message || 'Unknown git error').trim()
    throw new Error(detail)
  }
}

export type ParsedGitUrl = {
  url: string
  name: string
  github: { owner: string; repo: string } | null
}

function parseGitHubOwnerRepo(raw: string): { owner: string; repo: string } | null {
  const trimmed = raw
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  if (!trimmed || /^file:/i.test(trimmed)) return null

  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+)$/i)
  if (sshMatch) {
    const host = sshMatch[1].toLowerCase()
    if (host === 'github.com' || host.endsWith('.github.com')) {
      return { owner: sshMatch[2], repo: sshMatch[3] }
    }
    return null
  }

  const httpsMatch = trimmed.match(/^(?:https?:\/\/)(?:[^@]+@)?([^/]+)\/([^/]+)\/([^/]+)$/i)
  if (httpsMatch) {
    const host = httpsMatch[1].toLowerCase()
    if (host === 'github.com' || host.endsWith('.github.com')) {
      return { owner: httpsMatch[2], repo: httpsMatch[3] }
    }
    return null
  }

  const bare = trimmed.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/)
  if (bare) {
    return { owner: bare[1], repo: bare[2] }
  }

  return null
}

/** True when the URL targets github.com (or the configured GitHub login host). */
function isGitHubGitUrl(raw: string, loginHost?: string | null): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false

  const github = parseGitHubOwnerRepo(trimmed)
  if (!github) return false

  // Bare owner/repo is treated as GitHub.
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/.test(trimmed)) {
    return true
  }

  const hostMatch = trimmed.match(/^(?:https?:\/\/)?(?:[^@]+@)?([^/:]+)/i)
  const host = hostMatch?.[1]?.toLowerCase()
  if (!host) return false

  if (host === 'github.com' || host.endsWith('.github.com')) return true

  if (loginHost) {
    try {
      const configured = new URL(
        loginHost.includes('://') ? loginHost : `https://${loginHost}`
      ).hostname.toLowerCase()
      if (host === configured) return true
    } catch {
      // Ignore invalid override hosts.
    }
  }

  return false
}

function withGitHubAccessToken(url: string, token: string | null | undefined): string {
  if (!token) return url
  const match = url.match(/^(https?:\/\/)(?:[^@]+@)?(github\.com\/.+)$/i)
  if (!match) return url
  return `${match[1]}x-access-token:${encodeURIComponent(token)}@${match[2]}`
}

/** Test-only rewrite so Playwright can clone GitHub URLs from local fixtures. */
function resolveCloneUrl(url: string): string {
  if (process.env.NODE_ENV !== 'test') return url
  const raw = process.env.CEREBRO_E2E_GIT_URL_MAP?.trim()
  if (!raw) return url
  try {
    const map = JSON.parse(raw) as Record<string, string>
    return map[url] || map[url.replace(/\.git$/i, '')] || url
  } catch {
    return url
  }
}

function parseGitUrl(raw: string): ParsedGitUrl {
  const url = raw.trim()
  if (!url) {
    throw new Error('Git URL is required.')
  }

  const isSupported =
    /^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/)/i.test(url) ||
    /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/.test(url)

  if (!isSupported) {
    throw new Error('Enter a valid Git URL, such as https://github.com/org/repo.git')
  }

  const normalized = url.replace(/\.git$/i, '').replace(/\/+$/, '')
  const name = normalized
    .split(/[:/]/)
    .filter(Boolean)
    .pop()
    ?.replace(/[^A-Za-z0-9._-]/g, '-')

  if (!name) {
    throw new Error('Could not determine a repository name from that Git URL.')
  }

  const github = parseGitHubOwnerRepo(url)
  return { url, name, github }
}

async function cloneRepository(
  url: string,
  destination: string,
  token?: string | null
): Promise<string> {
  const cloneUrl = withGitHubAccessToken(resolveCloneUrl(url), token)
  await runGit(['clone', '--', cloneUrl, destination])
  return readDefaultBranch(destination)
}

async function readDefaultBranch(repoPath: string): Promise<string> {
  try {
    const head = await runGit(['symbolic-ref', '--short', 'HEAD'], repoPath)
    if (head) return head
  } catch {
    // Fall through to other probes when HEAD is detached.
  }

  try {
    const originHead = await runGit(['rev-parse', '--abbrev-ref', 'origin/HEAD'], repoPath)
    const branch = originHead.replace(/^origin\//, '')
    if (branch) return branch
  } catch {
    // Some clones (including file://) may not have origin/HEAD.
  }

  const current = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
  if (!current || current === 'HEAD') {
    throw new Error('Cloned the repository, but could not determine its default branch.')
  }
  return current
}

async function fetchRemote(repoPath: string, token?: string | null): Promise<void> {
  // Prefer the mapped local remote in tests so fetch/ls-remote do not hit the network.
  if (process.env.NODE_ENV === 'test') {
    try {
      const originUrl = await runGit(['remote', 'get-url', 'origin'], repoPath)
      const mapped = resolveCloneUrl(originUrl)
      if (mapped !== originUrl) {
        await runGit(['fetch', '--', mapped], repoPath)
        return
      }
    } catch {
      // Fall through.
    }
  }

  if (token) {
    try {
      const originUrl = await runGit(['remote', 'get-url', 'origin'], repoPath)
      const authed = withGitHubAccessToken(originUrl, token)
      if (authed !== originUrl) {
        await runGit(['fetch', '--', authed], repoPath)
        return
      }
    } catch {
      // Fall through to a plain fetch.
    }
  }
  await runGit(['fetch', '--all', '--prune'], repoPath)
}

async function listRemoteBranches(
  repoPath: string,
  token?: string | null
): Promise<string[]> {
  await fetchRemote(repoPath, token)

  let output: string
  try {
    output = await runGit(['ls-remote', '--heads', 'origin'], repoPath)
  } catch {
    // Local-only remotes may not support ls-remote; fall back to remote-tracking refs.
    output = await runGit(
      ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'],
      repoPath
    )
  }

  const branches = new Set<string>()
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // ls-remote: "<sha>\trefs/heads/<branch>"
    const lsMatch = trimmed.match(/\srefs\/heads\/(.+)$/)
    if (lsMatch) {
      branches.add(lsMatch[1])
      continue
    }

    // for-each-ref: "origin/<branch>"
    if (trimmed.startsWith('origin/')) {
      const name = trimmed.slice('origin/'.length)
      if (name && name !== 'HEAD') branches.add(name)
    }
  }

  return [...branches].sort((a, b) => a.localeCompare(b))
}

async function addWorktree(
  repoPath: string,
  destination: string,
  branch: string,
  token?: string | null
): Promise<void> {
  await fetchRemote(repoPath, token)

  // Prefer attaching an existing local branch; otherwise create from origin/<branch>.
  let localExists = false
  try {
    await runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoPath)
    localExists = true
  } catch {
    localExists = false
  }

  if (localExists) {
    await runGit(['worktree', 'add', destination, branch], repoPath)
    return
  }

  await runGit(
    ['worktree', 'add', '--track', '-b', branch, destination, `origin/${branch}`],
    repoPath
  )
}

function sanitizeBranchForPath(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch'
}

export {
  addWorktree,
  cloneRepository,
  fetchRemote,
  isGitHubGitUrl,
  listRemoteBranches,
  parseGitUrl,
  readDefaultBranch,
  sanitizeBranchForPath,
  withGitHubAccessToken
} from '@cerebro/core'
