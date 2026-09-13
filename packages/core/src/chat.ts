/** Transport-independent local agent contract. Native wire frames never cross this boundary. */
export type AgentHarness = 'claude' | 'codex' | 'pi'
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
}
export type AgentCapabilities = {
  resume: boolean
  cancel: boolean
  approvals: 'tools' | 'commands-and-files' | 'none'
  questions: boolean
  modelSelection: 'between-turns'
  imageInput: boolean
  steering: boolean
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
  status?: 'running' | 'completed' | 'failed' | 'interrupted'
  request?: {
    id: string
    kind: 'approval' | 'question'
    questions?: AgentQuestion[]
    resolved?: boolean
  }
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
}
export type AgentSessionSummary = Pick<
  AgentSession,
  'id' | 'title' | 'model' | 'status' | 'updatedAt'
>
export type ChatView = { session: AgentSession | null; sessions: AgentSessionSummary[] }
export type ChatCommand = {
  action: 'get' | 'new' | 'open' | 'send' | 'stop' | 'reply'
  workspaceId: number
  paneId: number
  sessionId?: string
  commandId?: string
  text?: string
  model?: AgentModel
  reasoning?: string
  requestId?: string
  allow?: boolean
  answers?: Record<string, string[]>
}
export type AgentDelta =
  | { type: 'item'; item: Omit<ChatItem, 'turnId'>; append?: boolean }
  | { type: 'binding'; nativeId: string }
export type AgentAnswer = { allow: boolean; answers: Record<string, string[]> }
export type AgentRequest = NonNullable<ChatItem['request']> & { title: string; text: string }
