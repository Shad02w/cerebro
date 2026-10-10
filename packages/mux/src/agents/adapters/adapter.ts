import type {
  AgentAnswer,
  AgentDelta,
  AgentModel,
  AgentRequest,
  AgentSession,
  ChatAttachment
} from '@cerebro/core'

/** A host-owned image file sent with the prompt. Bytes are read only when a harness needs them inline. */
export type RunAttachment = ChatAttachment & { path: string }
export type RunContext = {
  session: AgentSession
  text: string
  attachments?: RunAttachment[]
  signal: AbortSignal
  emit: (event: AgentDelta) => void
  ask: (request: AgentRequest) => Promise<AgentAnswer>
  /** Called by an adapter once it has a live handle to fold another message into this turn. Absent/unset means steering isn't available yet (or ever) for this run. */
  registerSteer?: (steer: (text: string, attachments: RunAttachment[]) => Promise<void>) => void
}
export interface AgentAdapter {
  models(cwd: string): Promise<AgentModel[]>
  run(context: RunContext): Promise<void>
}
