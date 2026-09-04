import type {
  WorkspacePullRequest,
  WorkspacePullRequestReviewDecision,
  WorkspacePullRequestState
} from '../shared/types'
import { readGitHubToken } from './secret-store'

function getApiUrl(): string {
  return (process.env.CEREBRO_GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/$/, '')
}

type GraphQlPullRequestNode = {
  number: number
  title: string
  url: string
  createdAt: string
  state: string
  isDraft?: boolean
  reviewDecision: string | null
  mergeable: string
  headRefName: string
  updatedAt: string
  repository: {
    nameWithOwner: string
  }
}

type GraphQlResponse = {
  data?: {
    repository?: {
      pullRequests?: {
        nodes?: GraphQlPullRequestNode[]
      }
    }
  }
  errors?: Array<{ message?: string }>
}

function mapState(raw: string): WorkspacePullRequestState {
  const value = raw.toUpperCase()
  if (value === 'MERGED') return 'merged'
  if (value === 'CLOSED') return 'closed'
  return 'open'
}

function mapReviewDecision(raw: string | null): WorkspacePullRequestReviewDecision {
  if (!raw) return 'none'
  const value = raw.toUpperCase()
  if (value === 'APPROVED') return 'approved'
  if (value === 'CHANGES_REQUESTED') return 'changes_requested'
  if (value === 'REVIEW_REQUIRED') return 'review_required'
  return 'none'
}

function mapMergeable(raw: string): boolean | null {
  const value = raw.toUpperCase()
  if (value === 'MERGEABLE') return true
  if (value === 'CONFLICTING') return false
  return null
}

function toPullRequest(node: GraphQlPullRequestNode): WorkspacePullRequest {
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    createdAt: node.createdAt,
    state: mapState(node.state),
    reviewDecision: mapReviewDecision(node.reviewDecision),
    mergeable: mapMergeable(node.mergeable),
    repoFullName: node.repository.nameWithOwner
  }
}

function preferPullRequest(
  current: GraphQlPullRequestNode | undefined,
  next: GraphQlPullRequestNode
): GraphQlPullRequestNode {
  if (!current) return next
  const currentOpen = current.state.toUpperCase() === 'OPEN'
  const nextOpen = next.state.toUpperCase() === 'OPEN'
  if (nextOpen && !currentOpen) return next
  if (currentOpen && !nextOpen) return current
  return new Date(next.updatedAt).getTime() >= new Date(current.updatedAt).getTime()
    ? next
    : current
}

const PULL_REQUESTS_QUERY = `
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 100, states: UPDATED_AT, direction: DESC) {
        nodes {
          number
          title
          url
          createdAt
          updatedAt
          state
          isDraft
          reviewDecision
          mergeable
          headRefName
          repository {
            nameWithOwner
          }
        }
      }
    }
  }
`

/** Fetch PRs for a repo and index them by head branch name. */
export async function fetchPullRequestsByBranch(
  owner: string,
  repo: string,
  token: string
): Promise<Map<string, WorkspacePullRequest>> {
  const response = await fetch(`${getApiUrl()}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: PULL_REQUESTS_QUERY,
      variables: { owner, name: repo }
    })
  })

  const text = await response.text()
  let body: GraphQlResponse | null = null
  if (text) {
    try {
      body = JSON.parse(text) as GraphQlResponse
    } catch {
      throw new Error(`Unexpected GraphQL response from GitHub (${response.status}).`)
    }
  }

  if (!response.ok) {
    const message =
      body?.errors?.[0]?.message ||
      (body && typeof body === 'object' && 'message' in body
        ? String((body as { message?: string }).message)
        : `GitHub GraphQL request failed (${response.status}).`)
    throw new Error(message)
  }

  if (body?.errors?.length) {
    throw new Error(body.errors[0]?.message || 'GitHub GraphQL request failed.')
  }

  const nodes = body?.data?.repository?.pullRequests?.nodes ?? []
  const byBranch = new Map<string, GraphQlPullRequestNode>()
  for (const node of nodes) {
    if (!node?.headRefName) continue
    byBranch.set(node.headRefName, preferPullRequest(byBranch.get(node.headRefName), node))
  }

  const result = new Map<string, WorkspacePullRequest>()
  for (const [branch, node] of byBranch) {
    result.set(branch, toPullRequest(node))
  }
  return result
}

export async function fetchPullRequestsByBranchIfConnected(
  owner: string,
  repo: string
): Promise<Map<string, WorkspacePullRequest>> {
  const token = readGitHubToken()
  if (!token) return new Map()
  try {
    return await fetchPullRequestsByBranch(owner, repo, token)
  } catch {
    return new Map()
  }
}
