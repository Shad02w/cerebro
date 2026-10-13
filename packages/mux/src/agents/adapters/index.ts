import type { AgentHarness } from '@cerebro/core'
import type { AgentAdapter, ConnectionHost, RunContext } from './adapter'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { piAdapter } from './pi'

export type {
  AgentAdapter,
  AgentConnection,
  AgentRouting,
  AutonomousTurn,
  BackgroundTaskUpdate,
  ConnectionHost,
  RunAttachment,
  RunContext
} from './adapter'
export { claudeAdapter, claudeModelLabel } from './claude'
export { codexAdapter } from './codex'
export { piAdapter } from './pi'

export const adapters: Record<AgentHarness, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  pi: piAdapter
}

/** Runs one turn on a throwaway connection: no autonomous turns, and background work dies with it. */
export async function runTurn(
  adapter: AgentAdapter,
  context: RunContext,
  host: Partial<ConnectionHost> = {}
): Promise<void> {
  const connection = adapter.connect(context.session, {
    autonomous: () => undefined,
    task: () => {},
    idle: () => {},
    exited: () => {},
    ...host
  })
  try {
    await connection.run(context)
  } finally {
    connection.close()
  }
}
