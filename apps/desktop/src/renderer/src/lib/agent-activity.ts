import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentActivityStatus, ChatAgentActivity } from '@cerebro/core'

const rank: Record<AgentActivityStatus, number> = {
  waiting: 0,
  running: 1,
  failed: 2,
  interrupted: 3
}

export const agentStatusPresentation = {
  running: { label: 'Agent running', color: 'text-sky-500' },
  waiting: { label: 'Agent needs your action', color: 'text-amber-500' },
  failed: { label: 'Agent failed', color: 'text-red-500' },
  interrupted: { label: 'Agent interrupted', color: 'text-orange-500' }
} as const

export function sortAgentActivity(agents: ChatAgentActivity[]): ChatAgentActivity[] {
  return agents.toSorted(
    (a, b) => rank[a.status] - rank[b.status] || a.harness.localeCompare(b.harness)
  )
}

export function useAgentActivity(): Map<number, ChatAgentActivity[]> {
  const overview = useQuery({
    queryKey: ['chat', 'overview'],
    queryFn: () => window.cerebro.chatOverview(),
    staleTime: Infinity
  })
  return useMemo(() => {
    const statuses = new Map<number, ChatAgentActivity[]>()
    for (const workspace of overview.data?.workspaces ?? [])
      statuses.set(workspace.workspaceId, workspace.agents)
    return statuses
  }, [overview.data])
}
