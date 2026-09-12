import {
  focusManager,
  QueryClient,
  queryOptions,
  type UseQueryOptions
} from '@tanstack/react-query'
import type { GitHubStatus, RepositoryPullRequests } from '@shared/types'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // These functions call Electron IPC. Main-process providers own network failures;
      // Chromium's offline signal must never pause local work or leave PR queries pending.
      networkMode: 'always',
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always'
    },
    mutations: { networkMode: 'always' }
  }
})
export const PR_REFRESH_MS = 60_000
export const projectsOptions = queryOptions({
  queryKey: ['projects'],
  queryFn: () => window.cerebro.listProjects()
})
export const githubOptions = queryOptions({
  queryKey: ['github-status'],
  queryFn: () => window.cerebro.getGitHubStatus(),
  refetchInterval: PR_REFRESH_MS,
  refetchIntervalInBackground: true
})

export class PullRequestUnavailable extends Error {
  readonly retryAt: number
  constructor(readonly result: RepositoryPullRequests) {
    super(result.issues.map((issue) => `${issue.provider}: ${issue.message}`).join('\n'))
    this.retryAt = Date.now() + (result.retryAfterMs ?? 0)
  }
}
export function pullRequestOptions(
  owner: string,
  repo: string
): UseQueryOptions<RepositoryPullRequests, Error, RepositoryPullRequests, string[]> {
  owner = owner.toLowerCase()
  repo = repo.toLowerCase()
  return queryOptions({
    queryKey: ['repository', owner, repo],
    queryFn: async () => {
      const previous = queryClient.getQueryState(['repository', owner, repo])?.error
      if (previous instanceof PullRequestUnavailable && previous.retryAt > Date.now())
        throw previous
      const result = await window.cerebro.getRepositoryPullRequests(owner, repo)
      if (!result.available) throw new PullRequestUnavailable(result)
      return result
    },
    refetchInterval: (query) =>
      query.state.error instanceof PullRequestUnavailable
        ? Math.max(PR_REFRESH_MS * 2, query.state.error.result.retryAfterMs ?? 0)
        : PR_REFRESH_MS,
    refetchIntervalInBackground: true
  })
}

export async function invalidateProjects(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['projects'] }),
    queryClient.invalidateQueries({ queryKey: ['workspace-repositories'] }),
    queryClient.invalidateQueries({ queryKey: ['branches'] })
  ])
}
export async function applyGitHubStatus(status: GitHubStatus): Promise<void> {
  await queryClient.cancelQueries({ queryKey: githubOptions.queryKey })
  const previous = queryClient.getQueryData(githubOptions.queryKey)
  queryClient.setQueryData(githubOptions.queryKey, status)
  if (
    previous?.state === status.state &&
    (status.state !== 'connected' ||
      (previous.state === 'connected' && previous.account.login === status.account.login))
  )
    return
  // Cancel before resetting so an old account's pending response cannot repopulate the cache.
  await queryClient.cancelQueries({ queryKey: ['repository'] })
  await queryClient.resetQueries({ queryKey: ['repository'] })
  await queryClient.invalidateQueries({ queryKey: ['branches'] })
}

/** Installed once at bootstrap; no component effects or duplicate timers. */
export function connectQueryEvents(): () => void {
  focusManager.setEventListener((handleFocus) => window.cerebro.onWindowFocus(handleFocus))
  const unsubscribeProjects = window.cerebro.onProjectsInvalidate(() => {
    void invalidateProjects()
  })
  const unsubscribeGitHub = window.cerebro.onGitHubStatus((status) => {
    void applyGitHubStatus(status)
  })
  return () => {
    unsubscribeProjects()
    unsubscribeGitHub()
    focusManager.setEventListener(() => () => {})
  }
}
