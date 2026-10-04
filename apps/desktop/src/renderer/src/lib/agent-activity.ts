import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentActivityStatus } from '@cerebro/core'

const rank: Record<AgentActivityStatus, number> = {
  waiting: 0,
  running: 1,
  failed: 2,
  interrupted: 3
}

/** One icon for a collapsed project: waiting, then running, then failed, then interrupted. */
export function aggregateAgentStatus(
  statuses: Iterable<AgentActivityStatus | undefined>
): AgentActivityStatus | null {
  let best: AgentActivityStatus | null = null
  for (const status of statuses) {
    if (!status) continue
    if (best === null || rank[status] < rank[best]) best = status
  }
  return best
}

export function useAgentActivity(): Map<number, AgentActivityStatus> {
  const overview = useQuery({
    queryKey: ['chat', 'overview'],
    queryFn: () => window.cerebro.chatOverview(),
    staleTime: Infinity
  })
  return useMemo(() => {
    const statuses = new Map<number, AgentActivityStatus>()
    for (const workspace of overview.data?.workspaces ?? [])
      statuses.set(workspace.workspaceId, workspace.status)
    return statuses
  }, [overview.data])
}
