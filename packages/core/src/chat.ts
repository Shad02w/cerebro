/** Transport-independent local agent contract. Native wire frames never cross this boundary. */
export type AgentAccessMode = 'full' | 'edit' | 'read'
export type AgentHarness = 'claude' | 'codex' | 'pi'
export const agentHarnesses = ['claude', 'codex', 'pi'] as const satisfies readonly AgentHarness[]
export function isAgentHarness(value: unknown): value is AgentHarness {
  return agentHarnesses.some((harness) => harness === value)
}
export type AgentModality = 'text' | 'image'
export type AgentModel = {
  key: string
  instance: string
  harness: AgentHarness
  provider: string
  id: string
  label: string
  source: 'native' | 'fallback'
  available: boolean
  reasoning: string[]
  /** Native input modalities. Absent means the harness did not report them; treat as text and image. */
  modalities?: AgentModality[]
}
export const chatImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ChatImageType = (typeof chatImageTypes)[number]
/** Bounds shared by the composer and the host. Images are stored by the host; snapshots keep metadata only. */
export const chatAttachmentLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxCount: 20,
  maxTotalBytes: 20 * 1024 * 1024,
  maxEdge: 2000
} as const
export type ChatAttachment = {
  id: string
  kind: 'image'
  name: string
  mimeType: ChatImageType
  bytes: number
  width?: number
  height?: number
}
/** Base64 payload sent with a `send` command. Never stored in a session snapshot. */
export type ChatAttachmentUpload = ChatAttachment & { data: string }
/** Marker text for the Nth attachment (1-based), as used by Claude Code and Codex. */
export const chatImageMarker = (index: number): string => `[Image #${index}]`
export const chatImageMarkerPattern = /\[Image #(\d+)\]/g
export type AgentCapabilities = {
  resume: boolean
  cancel: boolean
  approvals: 'tools' | 'commands-and-files' | 'none'
  questions: boolean
  modelSelection: 'between-turns'
  imageInput: boolean
  steering: boolean
  /** 'native' forks preserve the harness's own conversational memory; 'emulated' forks only replay visible items. */
  fork: 'native' | 'emulated'
}
export type AgentCatalog = {
  capabilities: Record<AgentHarness, AgentCapabilities>
  models: AgentModel[]
  favorites: AgentModel[]
  issues: Partial<Record<AgentHarness, string>>
}
export type AgentQuestion = {
  id: string
  label: string
  options?: string[]
  multiple?: boolean
}
export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type TodoItem = {
  id: string
  label: string
  status: TodoStatus
  /** Present-continuous phrase. The card shows it on an in-progress row. */
  activeLabel?: string
}
/** One full checklist. Adapters emit this; the session replaces its list. The UI never sees a patch. */
export type TodoSnapshot = {
  kind: 'todo'
  listId: string
  items: TodoItem[]
  explanation?: string
}
export const todoListId = (sessionId: string): string => `session:${sessionId}:todo`
export type ChatItem = {
  id: string
  turnId: string
  kind: 'user' | 'text' | 'reasoning' | 'tool' | 'diff' | 'plan' | 'notice' | 'request'
  text: string
  title?: string
  input?: string
  attachments?: ChatAttachment[]
  status?: 'running' | 'completed' | 'failed' | 'interrupted'
  /** On a `notice`: how a background task ended. */
  task?: AgentBackgroundTask
  request?: {
    id: string
    kind: 'approval' | 'question'
    questions?: AgentQuestion[]
    resolved?: boolean
  }
}
/** A message sent while a turn was running. Auto-sent as the next turn when the current one ends, or folded in early via 'steer'. */
export type QueuedMessage = {
  id: string
  text: string
  attachments?: ChatAttachment[]
  model: AgentModel
  reasoning?: string
  accessMode?: AgentAccessMode
}
/** A harness-reported snapshot of how much of the model's context window is in use. */
export type AgentContextUsage = {
  usedTokens: number
  contextWindow: number
  percentage: number
}
export type AgentBackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'
/**
 * Native work that outlives the turn that started it, owned by the session's live harness
 * process. Every harness reports it in this shape; `stopped` also covers work Cerebro ended by
 * closing the process.
 */
export type AgentBackgroundTask = {
  id: string
  title: string
  status: AgentBackgroundTaskStatus
  /** Transcript item that started the task, left running until the task settles. */
  itemId?: string
  /** Process exit code, when the harness reports one. */
  exitCode?: number
  /** The harness's one-line outcome. */
  summary?: string
  startedAt: number
  endedAt?: number
}
/** Plain-text outcome of a settled background task, for when the harness gave no summary. */
export function backgroundTaskOutcome(task: AgentBackgroundTask): string {
  const verb =
    task.status === 'failed'
      ? 'failed'
      : task.status === 'stopped'
        ? 'was stopped'
        : task.status === 'running'
          ? 'is running'
          : 'completed'
  const exit = task.exitCode === undefined ? '' : ` (exit code ${task.exitCode})`
  return `Background task ${verb}${exit}: ${task.title || task.id}`
}
export type AgentSession = {
  version: 1
  id: string
  workspaceId: number
  repositoryId: number | null
  cwd: string
  title: string
  /**
   * Automatic-title guard, stored in the session file so a restart can still tell a
   * generated title from a rename. `slice` is the original prompt cut. `first` is the
   * prompt-pass title, or null until that pass writes one. `settled` is true once the
   * response pass has been applied or skipped. Sessions loaded without these fields
   * are already settled and are not retitled.
   */
  slice?: string
  first?: string | null
  settled?: boolean
  model: AgentModel
  reasoning?: string
  accessMode?: AgentAccessMode
  status: 'idle' | 'running' | 'waiting' | 'interrupted' | 'failed'
  generation: string
  turnId?: string
  sequence: number
  updatedAt: number
  nativeId?: string
  error?: string
  items: ChatItem[]
  /** The one checklist for this chat. The latest snapshot replaces it. */
  todo?: TodoSnapshot
  /** Persisted before dispatch. Never replay an uncertain accepted command. */
  commands: string[]
  forkedFrom?: { sessionId: string; turnId: string }
  /** Native chain-entry id at the end of each turn, keyed by turnId. Populated by adapters that support native forking. */
  checkpoints?: Record<string, string>
  queue?: QueuedMessage[]
  contextUsage?: AgentContextUsage
  /**
   * Last settled turn outcome while idle. Sticky until the next turn starts —
   * viewing the tab does not clear it.
   */
  attention?: { kind: 'finished'; at: number }
  /** Running background tasks. Settled ones move into the transcript as `notice` items. */
  background?: AgentBackgroundTask[]
}
export type AgentSessionSummary = Pick<
  AgentSession,
  'id' | 'title' | 'model' | 'status' | 'updatedAt'
>
export type ChatView = { session: AgentSession | null; sessions: AgentSessionSummary[] }
/** Session status drawn on sidebar rows and agent tabs for an open pane. */
export type AgentActivityStatus = AgentSession['status'] | 'finished'
/** Map persisted session fields onto the status mark shown in the UI. */
export function agentActivityStatus(session: {
  status: AgentSession['status']
  attention?: AgentSession['attention']
}): AgentActivityStatus {
  if (session.status === 'idle' && session.attention?.kind === 'finished') return 'finished'
  return session.status
}
/** One open agent pane in a workspace (bound tab), including idle. */
export type ChatAgentActivity = {
  sessionId: string
  workspaceId: number
  harness: AgentHarness
  status: AgentActivityStatus
  title: string
  /** Open chat pane bound to this session. */
  paneId: number | null
}
export type ChatWorkspaceActivity = {
  workspaceId: number
  agents: ChatAgentActivity[]
}
/** Workspaces that currently have at least one open agent tab. */
export type ChatActivityOverview = {
  workspaces: ChatWorkspaceActivity[]
}
export type ChatAttachmentContent = { mimeType: ChatImageType; data: string }
export type ChatCommand = {
  action: 'get' | 'new' | 'open' | 'send' | 'stop' | 'reply' | 'fork' | 'steer' | 'dequeue'
  workspaceId: number
  paneId: number
  sessionId?: string
  /** For 'send': idempotency key. For 'steer'/'dequeue': the QueuedMessage.id to act on. */
  commandId?: string
  text?: string
  attachments?: ChatAttachmentUpload[]
  model?: AgentModel
  reasoning?: string
  accessMode?: AgentAccessMode
  requestId?: string
  allow?: boolean
  answers?: Record<string, string[]>
  /** Required for 'fork': the turn (section) to branch at. Everything up to and including it is copied. */
  turnId?: string
}
export type AgentDelta =
  | { type: 'item'; item: Omit<ChatItem, 'turnId'>; append?: boolean }
  | { type: 'binding'; nativeId: string }
  | { type: 'checkpoint'; turnId: string; chainId: string }
  /** A refusal-fallback retry superseded these already-emitted items; remove them from the transcript. */
  | { type: 'evict'; ids: string[] }
  | { type: 'usage'; usage: AgentContextUsage }
  /** Replaces the session checklist. Not a patch and not a provider event. */
  | { type: 'todo'; todo: TodoSnapshot }
export type AgentAnswer = { allow: boolean; answers: Record<string, string[]> }
export type AgentRequest = NonNullable<ChatItem['request']> & { title: string; text: string }
