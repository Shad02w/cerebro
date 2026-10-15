import type {
  AgentAnswer,
  AgentBackgroundTask,
  AgentDelta,
  AgentModel,
  AgentRequest,
  AgentSession,
  AgentSubagent,
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
/** One change in a background task's life. Fields left out keep their previous value. */
export type BackgroundTaskUpdate = Pick<AgentBackgroundTask, 'id' | 'status'> &
  Partial<Omit<AgentBackgroundTask, 'id' | 'status'>>
/**
 * One change in a child agent's life. Fields left out keep their previous value.
 * `announce` is set only when this patch is the harness reporting that child's end on the stream.
 */
export type SubagentUpdate = Pick<AgentSubagent, 'id' | 'status'> &
  Partial<Omit<AgentSubagent, 'id' | 'status'>> & { announce?: boolean }
/** A turn the harness started without a user message, such as a background task waking the agent. */
export type AutonomousTurn = { context: Omit<RunContext, 'text'>; settle: (error?: Error) => void }
/** Session-level callbacks a connection uses outside of the turn it was asked to run. */
export type ConnectionHost = {
  /** Returns the turn to stream into, or undefined when the session cannot take one now. */
  autonomous: () => AutonomousTurn | undefined
  /** A background task started, or settled as completed, failed or stopped. */
  task: (update: BackgroundTaskUpdate) => void
  /** A child agent was named, started, or settled. Shell jobs stay on `task`. */
  subagent: (update: SubagentUpdate) => void
  /** Output that arrived between turns. Items update in whichever turn owns them. */
  idle: (event: AgentDelta) => void
  /** The native process ended on its own; its background work is gone. */
  exited: (error: Error) => void
}
/** One live native process owned by a session. Background work it starts lives until `close`. */
export interface AgentConnection {
  run(context: RunContext): Promise<void>
  close(): void
}
export interface AgentAdapter {
  models(cwd: string): Promise<AgentModel[]>
  connect(session: AgentSession, host: ConnectionHost): AgentConnection
}
