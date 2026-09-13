import type { AgentHarness } from '@cerebro/core'
export const harnessLabels: Record<AgentHarness, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi'
}
export const catalogOptions = {
  queryKey: ['agent-catalog'],
  queryFn: () => window.cerebro.agentCatalog(),
  staleTime: 60_000
}
