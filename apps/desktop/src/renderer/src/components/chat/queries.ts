import type { AgentCatalog, AgentHarness, AgentSkillList } from '@cerebro/core'
import { isRecoverableMuxDisconnect } from '@shared/mux-retry'
export const harnessLabels: Record<AgentHarness, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi'
}
let catalogRefreshedOnStartup = false
/** First read each app launch rediscovers models. Later reads reuse the host cache until Refresh. */
export const catalogOptions = {
  queryKey: ['agent-catalog'] as const,
  queryFn: async (): Promise<AgentCatalog> => {
    const refresh = !catalogRefreshedOnStartup
    const catalog = await window.cerebro.agentCatalog(refresh)
    catalogRefreshedOnStartup = true
    return catalog
  },
  staleTime: 60_000
}

/** Live chat pane. A dropped mux socket is retried; the turn is still on the server. */
export function chatPaneQuery(
  workspaceId: number,
  paneId: number
): {
  queryKey: readonly ['chat', number, number]
  queryFn: () => ReturnType<typeof window.cerebro.chatCommand>
  staleTime: typeof Infinity
  retry: (failureCount: number, error: unknown) => boolean
} {
  return {
    queryKey: ['chat', workspaceId, paneId] as const,
    queryFn: () => window.cerebro.chatCommand({ action: 'get', workspaceId, paneId }),
    staleTime: Infinity,
    retry: (failureCount, error) => failureCount < 4 && isRecoverableMuxDisconnect(error)
  }
}

/** Skills the composer can mention for the selected harness in this pane. */
export function agentSkillOptions(
  workspaceId: number,
  paneId: number,
  harness: AgentHarness | undefined
): {
  queryKey: readonly ['agent-skills', number, number, AgentHarness | undefined]
  enabled: boolean
  queryFn: () => Promise<AgentSkillList>
  staleTime: number
} {
  return {
    queryKey: ['agent-skills', workspaceId, paneId, harness] as const,
    enabled: harness != null,
    queryFn: () => {
      if (!harness) throw new Error('Choose a model first.')
      return window.cerebro.agentSkills(workspaceId, paneId, harness)
    },
    staleTime: 15_000
  }
}
