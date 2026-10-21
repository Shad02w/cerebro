import {
  focusManager,
  QueryClient,
  queryOptions,
  type QueryKey,
  type UseQueryOptions
} from '@tanstack/react-query'
import type { GitHubStatus, ProjectListResult, RepositoryPullRequests } from '@shared/types'
import type { LayoutCommand, LayoutState } from '@cerebro/core'

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
const layoutKey = ['layout'] as const

/** Initial recovery, live mux events, and command replies share one layout. */
export function acceptLayout(next: LayoutState): LayoutState {
  return queryClient.setQueryData<LayoutState>(layoutKey, (current) =>
    !current || next.epoch !== current.epoch || next.revision >= current.revision ? next : current
  )!
}

/**
 * Shows a tab or pane focus before the mux confirms it. The revision is left alone, so the
 * reply (or any newer layout event) replaces this state through `acceptLayout`.
 */
export function applyOptimisticFocus(command: LayoutCommand): void {
  if (command.action !== 'focus') return
  queryClient.setQueryData<LayoutState>(layoutKey, (current) => {
    const workspace = current?.workspaces[command.workspaceId]
    if (!current || !workspace) return current
    const tab = workspace.tabs.find((candidate) =>
      command.target === 'tab'
        ? candidate.id === command.tabId
        : command.tabId != null
          ? candidate.id === command.tabId
          : candidate.id === workspace.activeTabId
    )
    if (!tab) return current
    const activePaneId =
      command.target === 'pane' && command.paneId ? command.paneId : tab.activePaneId
    if (workspace.activeTabId === tab.id && tab.activePaneId === activePaneId) return current
    return {
      ...current,
      workspaces: {
        ...current.workspaces,
        [command.workspaceId]: {
          ...workspace,
          activeTabId: tab.id,
          tabs: workspace.tabs.map((candidate) =>
            candidate === tab ? { ...candidate, activePaneId } : candidate
          )
        }
      }
    }
  })
}

export const layoutOptions = queryOptions({
  queryKey: layoutKey,
  queryFn: async () => acceptLayout(await window.cerebro.getLayout()),
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false
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

/** Moves the active workspace in the cached project list without refetching it. */
export function applyActiveWorkspace(workspaceId: number): void {
  queryClient.setQueryData<ProjectListResult>(projectsOptions.queryKey, (current) =>
    current && current.activeWorkspaceId !== workspaceId
      ? { ...current, activeWorkspaceId: workspaceId }
      : current
  )
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

const trailingChat = new Set<string>()
/**
 * Streaming agents send several `chat` events per second. Each marks matching queries stale,
 * but only observed, enabled queries refetch, and one already fetching gets a single trailing
 * refetch. Cancelling it instead would leave its mux request queued with nobody waiting.
 */
export function refreshChatQueries(queryKey: QueryKey): void {
  void queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
  const cache = queryClient.getQueryCache()
  for (const query of cache.findAll({ queryKey, type: 'active' })) {
    const refetch = (): Promise<void> =>
      queryClient.refetchQueries(
        { queryKey: query.queryKey, exact: true },
        { cancelRefetch: false }
      )
    if (query.state.fetchStatus !== 'fetching') {
      void refetch()
      continue
    }
    if (trailingChat.has(query.queryHash)) continue
    trailingChat.add(query.queryHash)
    const unsubscribe = cache.subscribe((event) => {
      if (event.query !== query) return
      if (event.type !== 'removed' && query.state.fetchStatus === 'fetching') return
      unsubscribe()
      trailingChat.delete(query.queryHash)
      if (event.type !== 'removed') void refetch()
    })
  }
}

/** Installed once at bootstrap; no component effects or duplicate timers. */
export function connectQueryEvents(): () => void {
  const unsubscribeChat = window.cerebro.onChatChanged(({ workspaceId }) => {
    refreshChatQueries(workspaceId ? ['chat', workspaceId] : ['chat'])
    // ['chat', workspaceId] does not match the sidebar aggregate at ['chat', 'overview'].
    if (workspaceId) {
      refreshChatQueries(['chat', 'overview'])
      refreshChatQueries(['chat', 'search'])
    }
  })
  const unsubscribeLayout = window.cerebro.onLayoutChanged(acceptLayout)
  focusManager.setEventListener((handleFocus) => window.cerebro.onWindowFocus(handleFocus))
  const unsubscribeProjects = window.cerebro.onProjectsInvalidate((change) => {
    // A selection-only change is applied in place; refetching would rescan every project.
    if (change?.activeWorkspaceId != null) applyActiveWorkspace(change.activeWorkspaceId)
    else void invalidateProjects()
  })
  const unsubscribeGitHub = window.cerebro.onGitHubStatus((status) => {
    void applyGitHubStatus(status)
  })
  return () => {
    unsubscribeChat()
    unsubscribeLayout()
    unsubscribeProjects()
    unsubscribeGitHub()
    focusManager.setEventListener(() => () => {})
  }
}
