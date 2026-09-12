import type { WorkspaceCiCheck, WorkspacePullRequest } from '../shared/types'

export type GraphQlCheck =
  | {
      __typename: 'CheckRun'
      name: string
      status: string
      conclusion: string | null
      detailsUrl: string | null
    }
  | {
      __typename: 'StatusContext'
      context: string
      state: string
      description: string | null
      targetUrl: string | null
    }

type CheckRollup = {
  state: string
  contexts?: { totalCount: number; nodes: Array<GraphQlCheck | null> } | null
}

export type GraphQlPullRequestNode = {
  number: number
  title: string
  url: string
  createdAt: string
  state: string
  isDraft: boolean
  reviewDecision: string | null
  mergeable: string
  headRefName: string
  updatedAt: string
  commits?: { nodes: Array<{ commit: { statusCheckRollup?: CheckRollup | null } }> }
  headRepository: { nameWithOwner: string } | null
  repository: { nameWithOwner: string }
}

export type GraphQlResponse = {
  data?: {
    repository?: {
      pullRequests?: {
        nodes: GraphQlPullRequestNode[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    } | null
  }
  errors?: Array<{ message?: string; type?: string; path?: Array<string | number> }>
}

export const PULL_REQUESTS_QUERY = `
  query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 100, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title url createdAt updatedAt state isDraft reviewDecision mergeable headRefName
          commits(last: 1) { nodes { commit { statusCheckRollup {
            state
            contexts(first: 20) {
              totalCount
              nodes {
                __typename
                ... on CheckRun { name status conclusion detailsUrl }
                ... on StatusContext { context state description targetUrl }
              }
            }
          } } } }
          headRepository { nameWithOwner }
          repository { nameWithOwner }
        }
      }
    }
  }
`

export type GraphQlRequest = (body: {
  query: string
  variables: { owner: string; name: string; cursor: string | null }
}) => Promise<GraphQlResponse>

/** Share one paginated repository result across all of its checkouts. */
export async function fetchPullRequestsByBranch(
  owner: string,
  repo: string,
  request: GraphQlRequest
): Promise<Record<string, WorkspacePullRequest>> {
  const byBranch = new Map<string, GraphQlPullRequestNode>()
  const bodyCiUnavailable = new Set<GraphQlPullRequestNode>()
  const cursors = new Set<string>()
  let cursor: string | null = null
  do {
    const body = await request({
      query: PULL_REQUESTS_QUERY,
      variables: { owner, name: repo, cursor }
    })
    // Missing check permissions must not hide otherwise readable PRs.
    const errors = body.errors?.filter((error) => !error.path?.includes('statusCheckRollup'))
    if (errors?.length) throw new Error(errors.map((error) => error.message).join('; '))
    const page = body.data?.repository?.pullRequests
    if (!page) throw new Error('GitHub did not grant access to this repository’s pull requests.')
    for (const [index, node] of page.nodes.entries()) {
      if (
        body.errors?.some(
          (error) => error.path?.includes('statusCheckRollup') && error.path[3] === index
        )
      )
        bodyCiUnavailable.add(node)
      // A branch in a fork can have the same name as a branch in this repository.
      if (node.headRepository?.nameWithOwner.toLowerCase() !== `${owner}/${repo}`.toLowerCase())
        continue
      const current = byBranch.get(node.headRefName)
      const open = node.state === 'OPEN'
      const currentOpen = current?.state === 'OPEN'
      if (
        !current ||
        (open && !currentOpen) ||
        (open === currentOpen && node.updatedAt > current.updatedAt)
      ) {
        byBranch.set(node.headRefName, node)
      }
    }
    if (!page.pageInfo.hasNextPage) break
    cursor = page.pageInfo.endCursor
    if (!cursor || cursors.has(cursor))
      throw new Error('GitHub returned an invalid pagination cursor.')
    cursors.add(cursor)
  } while (cursor)

  return Object.fromEntries(
    [...byBranch].map(([branch, node]) => [
      branch,
      {
        number: node.number,
        title: node.title,
        url: node.url,
        createdAt: node.createdAt,
        state: node.state === 'MERGED' ? 'merged' : node.state === 'CLOSED' ? 'closed' : 'open',
        isDraft: node.isDraft,
        reviewDecision:
          node.reviewDecision === 'APPROVED'
            ? 'approved'
            : node.reviewDecision === 'CHANGES_REQUESTED'
              ? 'changes_requested'
              : node.reviewDecision === 'REVIEW_REQUIRED'
                ? 'review_required'
                : 'none',
        mergeable:
          node.mergeable === 'MERGEABLE' ? true : node.mergeable === 'CONFLICTING' ? false : null,
        ciStatus: bodyCiUnavailable.has(node) ? 'unavailable' : ciStatus(node),
        ciChecks: bodyCiUnavailable.has(node) ? [] : checkDetails(node),
        ciCheckCount: bodyCiUnavailable.has(node)
          ? undefined
          : node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.totalCount,
        repoFullName: node.repository.nameWithOwner
      } satisfies WorkspacePullRequest
    ])
  )
}

function ciStatus(node: GraphQlPullRequestNode): WorkspacePullRequest['ciStatus'] {
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup
  if (rollup === undefined) return 'unavailable'
  if (rollup === null) return 'none'
  if (rollup.state === 'SUCCESS') return 'success'
  if (rollup.state === 'FAILURE' || rollup.state === 'ERROR') return 'failure'
  if (rollup.state === 'PENDING' || rollup.state === 'EXPECTED') return 'pending'
  return 'unavailable'
}

function checkDetails(node: GraphQlPullRequestNode): WorkspaceCiCheck[] {
  const contexts = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  return contexts
    .filter((check): check is GraphQlCheck => !!check)
    .map((check) => {
      const raw =
        check.__typename === 'CheckRun'
          ? check.status === 'COMPLETED'
            ? (check.conclusion ?? 'UNAVAILABLE')
            : check.status
          : check.state === 'ERROR'
            ? 'FAILURE'
            : check.state === 'EXPECTED'
              ? 'PENDING'
              : check.state
      const states: Record<string, WorkspaceCiCheck['state']> = {
        SUCCESS: 'success',
        FAILURE: 'failure',
        IN_PROGRESS: 'in_progress',
        QUEUED: 'queued',
        REQUESTED: 'queued',
        PENDING: 'pending',
        WAITING: 'waiting',
        PENDING_APPROVAL: 'action_required',
        CANCELLED: 'cancelled',
        SKIPPED: 'skipped',
        NEUTRAL: 'neutral',
        TIMED_OUT: 'timed_out',
        ACTION_REQUIRED: 'action_required',
        STARTUP_FAILURE: 'startup_failure',
        STALE: 'stale'
      }
      const url = check.__typename === 'CheckRun' ? check.detailsUrl : check.targetUrl
      return {
        name: check.__typename === 'CheckRun' ? check.name : check.context,
        state: states[raw] ?? 'unavailable',
        url: url && /^https?:\/\//i.test(url) ? url : null,
        description: check.__typename === 'StatusContext' ? check.description : null
      }
    })
}
