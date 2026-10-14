import type { AgentCatalog, AgentHarness, AgentSkillList } from '@cerebro/core'
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
