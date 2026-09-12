import type { GraphQlCheck } from '../src/main/github-prs'
import { buildSchema, parse, validate } from 'graphql'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export type MockPullRequest = {
  number: number
  title: string
  url: string
  createdAt: string
  updatedAt: string
  ciStatus?: string | null
  ciChecks?: GraphQlCheck[]
  isDraft?: boolean
  headRepoFullName?: string | null
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  headRefName: string
  repoFullName: string
}

export type MockGitHubServer = {
  baseUrl: string
  installationHtmlUrl: string
  authorize: (deviceCode?: string) => void
  lastUserCode: () => string | null
  setPullRequests: (owner: string, repo: string, pullRequests: MockPullRequest[]) => void
  setInstallationAccess: (installed: boolean, ready?: boolean) => void
  setApiError: (status: number | null) => void
  holdPullRequests: () => () => void
  requestCount: () => number
  refreshCount: () => number
  expireAccessTokens: () => void
  setTokenLifetime: (seconds: number) => void
  close: () => Promise<void>
}

type PendingDevice = {
  deviceCode: string
  userCode: string
  authorized: boolean
  token: string
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function repoKey(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`
}

export async function startMockGitHubServer(): Promise<MockGitHubServer> {
  const devices = new Map<string, PendingDevice>()
  const tokens = new Map<string, string>()
  const pullRequestsByRepo = new Map<string, MockPullRequest[]>()
  const refreshTokens = new Set<string>()
  let installed = true
  let permissionsReady = true
  let lifetime = 28800
  let refreshCount = 0
  let requestCount = 0
  let apiError: number | null = null
  let pullRequestsReady = Promise.resolve()
  let releasePullRequests = (): void => {}
  let counter = 0
  let lastUserCode: string | null = null
  let baseUrl = 'http://127.0.0.1'

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', baseUrl)
      const method = req.method ?? 'GET'

      if (method === 'POST' && url.pathname === '/login/device/code') {
        await readBody(req)
        counter += 1
        const deviceCode = `device-code-${counter}`
        const userCode = `CODE-${String(counter).padStart(4, '0')}`
        const token = `token-${counter}`
        devices.set(deviceCode, {
          deviceCode,
          userCode,
          authorized: false,
          token
        })
        lastUserCode = userCode
        sendJson(res, 200, {
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: `${baseUrl}/login/device`,
          expires_in: 900,
          interval: 1
        })
        return
      }

      if (method === 'POST' && url.pathname === '/login/oauth/access_token') {
        const body = await readBody(req)
        const form = new URLSearchParams(body)
        if (form.get('grant_type') === 'refresh_token') {
          const refreshToken = form.get('refresh_token') ?? ''
          if (!refreshTokens.delete(refreshToken)) {
            sendJson(res, 200, { error: 'bad_refresh_token' })
            return
          }
          refreshCount++
          const token = `renewed-${refreshCount}`
          tokens.set(token, 'octocat')
          refreshTokens.add(`refresh-${token}`)
          sendJson(res, 200, {
            access_token: token,
            expires_in: lifetime,
            refresh_token: `refresh-${token}`,
            refresh_token_expires_in: 15897600
          })
          return
        }
        const deviceCode = form.get('device_code') ?? ''
        const device = devices.get(deviceCode)
        if (!device) {
          sendJson(res, 200, {
            error: 'incorrect_device_code',
            error_description: 'Unknown device code'
          })
          return
        }
        if (!device.authorized) {
          sendJson(res, 200, {
            error: 'authorization_pending',
            error_description: 'Authorization pending'
          })
          return
        }
        tokens.set(device.token, device.userCode)
        refreshTokens.add(`refresh-${device.token}`)
        sendJson(res, 200, {
          access_token: device.token,
          token_type: 'bearer',
          scope: '',
          expires_in: lifetime,
          refresh_token: `refresh-${device.token}`,
          refresh_token_expires_in: 15897600
        })
        return
      }

      if (method === 'GET' && url.pathname === '/user/installations') {
        const auth = req.headers.authorization ?? ''
        const token = auth.replace(/^(?:Bearer|token)\s+/i, '').trim()
        if (!token || !tokens.has(token)) {
          sendJson(res, 401, { message: 'Bad credentials' })
          return
        }
        sendJson(res, 200, {
          total_count: installed ? 1 : 0,
          installations: !installed
            ? []
            : [
                {
                  id: 42,
                  account: {
                    login: 'octocat',
                    id: 1,
                    type: 'User'
                  },
                  html_url: `${baseUrl}/settings/installations/42`,
                  app_id: 1,
                  app_slug: 'cerebro',
                  target_id: 1,
                  target_type: 'User',
                  repository_selection: 'selected',
                  permissions: permissionsReady
                    ? { contents: 'read', metadata: 'read', pull_requests: 'read' }
                    : {}
                }
              ]
        })
        return
      }

      if (method === 'GET' && url.pathname === '/user') {
        const auth = req.headers.authorization ?? ''
        const token = auth.replace(/^(?:Bearer|token)\s+/i, '').trim()
        if (!token || !tokens.has(token)) {
          sendJson(res, 401, { message: 'Bad credentials' })
          return
        }
        sendJson(res, 200, {
          login: 'octocat',
          name: 'The Octocat',
          // data: URL so CSP (img-src 'self' data: + GitHub hosts) still allows e2e avatars
          avatar_url:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        })
        return
      }

      if (method === 'GET' && /^\/repos\/[^/]+\/[^/]+\/branches$/.test(url.pathname)) {
        const token = (req.headers.authorization ?? '').replace(/^(?:Bearer|token)\s+/i, '').trim()
        if (!tokens.has(token)) {
          sendJson(res, 401, { message: 'Bad credentials' })
          return
        }
        if (apiError) {
          sendJson(res, apiError, { message: 'Repository access failed' })
          return
        }
        sendJson(
          res,
          200,
          ['main', 'feature/review', 'feature/conflict', 'feature/closed'].map((name) => ({ name }))
        )
        return
      }

      if (method === 'POST' && url.pathname === '/graphql') {
        requestCount++
        if (apiError) {
          sendJson(res, apiError, { message: 'Repository access failed' })
          return
        }
        const auth = req.headers.authorization ?? ''
        const token = auth.replace(/^(?:Bearer|token)\s+/i, '').trim()
        if (!token || !tokens.has(token)) {
          sendJson(res, 401, { message: 'Bad credentials' })
          return
        }

        const body = await readBody(req)
        let parsed: {
          query: string
          variables?: { owner?: string; name?: string; cursor?: string | null }
        }
        try {
          parsed = JSON.parse(body) as typeof parsed
          const errors = validate(pullRequestSchema, parse(parsed.query))
          if (errors.length) {
            sendJson(res, 200, { errors: errors.map((error) => ({ message: error.message })) })
            return
          }
        } catch {
          sendJson(res, 400, { message: 'Invalid JSON' })
          return
        }

        await pullRequestsReady
        const owner = parsed.variables?.owner ?? 'octocat'
        const name = parsed.variables?.name ?? 'hello-world'
        const allNodes = [...(pullRequestsByRepo.get(repoKey(owner, name)) ?? [])].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        )
        const offset = Number(parsed.variables?.cursor ?? 0)
        const nodes = allNodes.slice(offset, offset + 100)

        sendJson(res, 200, {
          data: {
            repository: {
              pullRequests: {
                pageInfo: {
                  hasNextPage: offset + 100 < allNodes.length,
                  endCursor: String(offset + 100)
                },
                nodes: nodes.map((pr) => ({
                  number: pr.number,
                  title: pr.title,
                  url: pr.url,
                  createdAt: pr.createdAt,
                  updatedAt: pr.updatedAt,
                  state: pr.state,
                  isDraft: pr.isDraft ?? false,
                  commits: {
                    nodes: [
                      {
                        commit: {
                          statusCheckRollup: pr.ciStatus
                            ? {
                                state: pr.ciStatus,
                                contexts: {
                                  totalCount: pr.ciChecks?.length ?? 0,
                                  nodes: (pr.ciChecks ?? []).slice(0, 20)
                                }
                              }
                            : null
                        }
                      }
                    ]
                  },
                  headRepository:
                    pr.headRepoFullName === null
                      ? null
                      : { nameWithOwner: pr.headRepoFullName ?? pr.repoFullName },
                  reviewDecision: pr.reviewDecision,
                  mergeable: pr.mergeable,
                  headRefName: pr.headRefName,
                  repository: {
                    nameWithOwner: pr.repoFullName
                  }
                }))
              }
            }
          }
        })
        return
      }

      if (method === 'GET' && url.pathname === '/avatar.png') {
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64'
        )
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
        res.end(png)
        return
      }

      if (method === 'GET' && url.pathname === '/login/device') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('Mock GitHub device verification page')
        return
      }

      sendJson(res, 404, { message: `Not found: ${method} ${url.pathname}` })
    } catch (error) {
      sendJson(res, 500, {
        message: error instanceof Error ? error.message : 'Mock server error'
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind mock GitHub server')
  }

  baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    requestCount: () => requestCount,
    holdPullRequests: () => {
      pullRequestsReady = new Promise<void>((resolve) => {
        releasePullRequests = resolve
      })
      return releasePullRequests
    },
    setInstallationAccess: (value, ready = true) => {
      installed = value
      permissionsReady = ready
    },
    refreshCount: () => refreshCount,
    setApiError: (status) => {
      apiError = status
    },
    expireAccessTokens: () => tokens.clear(),
    setTokenLifetime: (seconds) => {
      lifetime = seconds
    },
    installationHtmlUrl: `${baseUrl}/settings/installations/42`,
    authorize: (deviceCode?: string): void => {
      if (deviceCode) {
        const device = devices.get(deviceCode)
        if (device) device.authorized = true
        return
      }
      const latest = [...devices.values()].at(-1)
      if (latest) latest.authorized = true
    },
    lastUserCode: (): string | null => lastUserCode,
    setPullRequests: (owner, repo, pullRequests): void => {
      pullRequestsByRepo.set(repoKey(owner, repo), pullRequests)
    },
    close: async (): Promise<void> => {
      releasePullRequests()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections()
        }
      })
    }
  }
}

// The relevant subset of GitHub's schema: validate arguments/enums, not just fixture variables.
const pullRequestSchema = buildSchema(`
  enum PullRequestState { OPEN CLOSED MERGED }
  enum OrderDirection { ASC DESC }
  enum IssueOrderField { CREATED_AT UPDATED_AT COMMENTS }
  input IssueOrder { field: IssueOrderField!, direction: OrderDirection! }
  type PageInfo { hasNextPage: Boolean!, endCursor: String }
  type CheckRun { name: String!, status: String!, conclusion: String, detailsUrl: String }
  type StatusContext { context: String!, state: String!, description: String, targetUrl: String }
  union StatusCheckRollupContext = CheckRun | StatusContext
  type StatusCheckRollupContextConnection { totalCount: Int!, nodes: [StatusCheckRollupContext] }
  type StatusCheckRollup { state: String!, contexts(first: Int): StatusCheckRollupContextConnection }
  type Commit { statusCheckRollup: StatusCheckRollup }
  type PullRequestCommit { commit: Commit! }
  type PullRequestCommitConnection { nodes: [PullRequestCommit!]! }
  type PullRequest { commits(last: Int): PullRequestCommitConnection!, number: Int!, title: String!, url: String!, createdAt: String!, updatedAt: String!, state: PullRequestState!, isDraft: Boolean!, reviewDecision: String, mergeable: String!, headRefName: String!, headRepository: Repository, repository: Repository! }
  type PullRequestConnection { nodes: [PullRequest!]!, pageInfo: PageInfo! }
  type Repository { nameWithOwner: String!, pullRequests(first: Int, after: String, states: [PullRequestState!], orderBy: IssueOrder): PullRequestConnection! }
  type Query { repository(owner: String!, name: String!): Repository }
`)
