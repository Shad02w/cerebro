import type {
  AgentAnswer,
  AgentBackgroundTask,
  AgentDelta,
  AgentModel,
  AgentRequest,
  AgentSession,
  AgentSkill,
  AgentSubagent,
  ChatAttachment,
  ChatSkillMention
} from '@cerebro/core'

/** A host-owned image file sent with the prompt. Bytes are read only when a harness needs them inline. */
export type RunAttachment = ChatAttachment & { path: string }
export type RunContext = {
  session: AgentSession
  text: string
  attachments?: RunAttachment[]
  /** Skills mentioned in `text`. Adapters rewrite those tokens into the harness prompt. Codex resolves `$name` from that text. */
  skills?: ChatSkillMention[]
  signal: AbortSignal
  emit: (event: AgentDelta) => void
  ask: (request: AgentRequest) => Promise<AgentAnswer>
  /** Called by an adapter once it has a live handle to fold another message into this turn. Absent/unset means steering isn't available yet (or ever) for this run. */
  registerSteer?: (
    steer: (
      text: string,
      attachments: RunAttachment[],
      skills?: ChatSkillMention[]
    ) => Promise<void>
  ) => void
}
/** One change in a background task's life. Fields left out keep their previous value. */
export type BackgroundTaskUpdate = Pick<AgentBackgroundTask, 'id' | 'status'> &
  Partial<Omit<AgentBackgroundTask, 'id' | 'status'>>
/**
 * One change in a child agent's life. Fields left out keep their previous value.
 * `announce` is set only when this patch is the harness reporting that child's end on the stream.
 */
export type SubagentUpdate = Pick<AgentSubagent, 'id' | 'status'> &
  Partial<Omit<AgentSubagent, 'id' | 'status'>> & {
    announce?: boolean
    /** Drop this other id. The same child was reported under two native ids. */
    replaces?: string
  }
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
  /** The native runtime ended on its own; its background work is gone. */
  exited: (error: Error) => void
}
/**
 * One live harness connection. `close` stops this session's native work.
 * Claude and Pi own a process. Codex is a thread on the shared app-server.
 */
export interface AgentConnection {
  run(context: RunContext): Promise<void>
  close(): void
  /** Pi: user messages on the active branch, in order, with the entry id rewind forks before. */
  forkPoints?(): Promise<Array<{ entryId: string; text: string }>>
  /** Pi: branch a new session file before this user entry. The original file stays. */
  forkBefore?(entryId: string): Promise<{ nativeId?: string; cancelled: boolean }>
  /** Pi: open a previous session file in this process. */
  switchSession?(sessionPath: string): Promise<{ cancelled: boolean }>
}
export interface AgentAdapter {
  models(cwd: string): Promise<AgentModel[]>
  /** Skills available in `cwd` for this harness. Optional so test doubles can omit it. */
  skills?(cwd: string): Promise<AgentSkill[]>
  connect(session: AgentSession, host: ConnectionHost): AgentConnection
}
