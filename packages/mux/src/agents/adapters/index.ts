import type { AgentHarness } from '@cerebro/core'
import type { AgentAdapter } from './adapter'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { piAdapter } from './pi'

export type { AgentAdapter, RunAttachment, RunContext } from './adapter'
export { claudeAdapter, claudeModelLabel } from './claude'
export { codexAdapter } from './codex'
export { piAdapter } from './pi'

export const adapters: Record<AgentHarness, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  pi: piAdapter
}
