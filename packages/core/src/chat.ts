/** Transport-independent local agent contract. Native wire frames never cross this boundary. */
export type AgentAccessMode = 'full' | 'edit' | 'read'
export type AgentHarness = 'claude' | 'codex' | 'pi'
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
export type ChatItem = {
  id: string
  turnId: string
  kind: 'user' | 'text' | 'reasoning' | 'tool' | 'diff' | 'plan' | 'notice' | 'request'
  text: string
  title?: string
  input?: string
  attachments?: ChatAttachment[]
  status?: 'running' | 'completed' | 'failed' | 'interrupted'
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
export type AgentSession = {
  version: 1
  id: string
  workspaceId: number
  repositoryId: number | null
  cwd: string
  title: string
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
  /** Persisted before dispatch. Never replay an uncertain accepted command. */
  commands: string[]
  forkedFrom?: { sessionId: string; turnId: string }
  /** Native chain-entry id at the end of each turn, keyed by turnId. Populated by adapters that support native forking. */
  checkpoints?: Record<string, string>
  queue?: QueuedMessage[]
}
export type AgentSessionSummary = Pick<
  AgentSession,
  'id' | 'title' | 'model' | 'status' | 'updatedAt'
>
export type ChatView = { session: AgentSession | null; sessions: AgentSessionSummary[] }
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
export type AgentAnswer = { allow: boolean; answers: Record<string, string[]> }
export type AgentRequest = NonNullable<ChatItem['request']> & { title: string; text: string }
