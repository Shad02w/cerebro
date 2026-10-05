import type { AgentCatalog, AgentHarness } from '@cerebro/core'
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
