import type { ChatSkillMention } from './skills'

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
  /**
   * 'native' can resume the harness before a chosen prompt.
   * 'emulated' can hide the transcript, but the next send starts a fresh native session.
   */
  rewind: 'native' | 'emulated'
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
  /**
   * On a `notice`: a child agent whose end arrived on the harness stream.
   * `text` is `agentFinishedLine`. The child's response is not stored on this item.
   */
  agent?: AgentSubagent
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
  /** Resolved mentions. Absent on messages queued before skills existed. */
  skills?: ChatSkillMention[]
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
export type AgentSubagentStatus = 'created' | 'running' | 'completed' | 'failed' | 'stopped'
/** Token counts a harness reported for one child. Each field is absent when the harness did not send it. */
export type AgentSubagentTokens = {
  input?: number
  output?: number
  total?: number
}
/**
 * One child agent, normalized across harnesses. `created` has been named and has not started.
 * `running` is executing. The other three statuses are finished and stay on the list.
 */
export type AgentSubagent = {
  id: string
  title: string
  status: AgentSubagentStatus
  createdAt: number
  /**
   * Wall clock when the child starts running. The first running update stamps this when the
   * harness omits it, and the panel ticks from it. A created row leaves it unset and shows no elapsed.
   */
  startedAt?: number
  finishedAt?: number
  /**
   * Harness-reported duration, in milliseconds. When set, the panel shows this instead of a local
   * tick. A later start or finish time that does not include a duration clears it.
   */
  durationMs?: number
  tokens?: AgentSubagentTokens
  summary?: string
  /** Model the harness reported for this child. Absent when that child sent none. */
  model?: string
  /** Effort the harness reported for this child. Absent when that child sent none. */
  effort?: string
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
/** Compact token count. Under 1000 stays whole. Thousands and millions use one decimal, dropped when the unit is round. */
export function compactTokenCount(value: number): string {
  const negative = value < 0
  const abs = Math.abs(value)
  if (!Number.isFinite(abs)) return '0'
  if (abs < 1000) return `${negative ? '-' : ''}${Math.round(abs)}`
  const scaled = (scale: number, suffix: 'k' | 'm'): string => {
    const tenths = Math.round((abs / scale) * 10)
    const whole = Math.trunc(tenths / 10)
    const frac = Math.abs(tenths % 10)
    const body = frac === 0 ? `${whole}` : `${whole}.${frac}`
    return `${negative ? '-' : ''}${body}${suffix}`
  }
  if (abs >= 999_950) return scaled(1_000_000, 'm')
  return scaled(1_000, 'k')
}

/** Elapsed time. Hours drop the seconds. */
export function formatAgentElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${rest}s`
  return `${rest}s`
}

function reportedElapsed(agent: AgentSubagent): number | undefined {
  if (agent.durationMs !== undefined) return agent.durationMs
  if (agent.startedAt === undefined || agent.finishedAt === undefined) return undefined
  return agent.finishedAt - agent.startedAt
}

function reportedTokens(tokens: AgentSubagentTokens | undefined): string | undefined {
  if (!tokens) return undefined
  const { input, output, total } = tokens
  if (input === undefined && output === undefined && total === undefined) return undefined
  const shown =
    total ?? (input !== undefined && output !== undefined ? input + output : (input ?? output))
  if (shown === undefined) return undefined
  const split =
    input !== undefined && output !== undefined
      ? ` (${compactTokenCount(input)} in, ${compactTokenCount(output)} out)`
      : ''
  return `${compactTokenCount(shown)}${split}`
}

/**
 * One chat line for a child whose end arrived on the stream.
 * Model, effort, elapsed, and tokens are left out when that child never reported them.
 */
export function agentFinishedLine(agent: AgentSubagent): string {
  const verb =
    agent.status === 'failed' ? 'failed' : agent.status === 'stopped' ? 'stopped' : 'finished'
  const title = agent.title.trim() || agent.id
  const elapsed = reportedElapsed(agent)
  return [
    `Agent "${title}" ${verb}`,
    agent.model?.trim() || undefined,
    agent.effort?.trim() || undefined,
    elapsed === undefined ? undefined : formatAgentElapsed(elapsed),
    reportedTokens(agent.tokens)
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
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
  /** Native chain-entry id at the end of each turn, keyed by turnId. Pi also keys the user item id to its entry id. */
  checkpoints?: Record<string, string>
  /** Set while a rewind is pending. Undo restores `tail`. A send drops it. */
  rewind?: SessionRewind
  /**
   * Consumed by the next harness connect. Never written to the session file.
   * Claude sets this when a rewound send must resume at a checkpoint.
   */
  nativeResume?: { at?: string; fork: boolean }
  queue?: QueuedMessage[]
  contextUsage?: AgentContextUsage
  /**
   * Last settled turn outcome while idle. Sticky until the next turn starts —
   * viewing the tab does not clear it.
   */
  attention?: { kind: 'finished'; at: number }
  /**
   * Wall clock when the current turn started. Set while status is `running` or `waiting`.
   * Cleared once the turn settles. The sidebar formats a coarse clock from it.
   */
  runningSince?: number
  /** Running background tasks. Settled ones move into the transcript as `notice` items. */
  background?: AgentBackgroundTask[]
  /**
   * Child agents named by this session. Finished rows stay on the list. When the harness
   * reports that child's end on the stream, one notice line is added. The child's response
   * text is not copied into the transcript.
   */
  subagents?: AgentSubagent[]
}
/** A cut that hides the chosen prompt and everything after it until Undo or the next send. */
export type SessionRewind = {
  /** User item the cut starts at. */
  itemId: string
  turnId: string
  /** Items from that user item through the original tip, in order. */
  tail: ChatItem[]
  /** Native binding of the tip, so Undo can put it back. */
  nativeId?: string
  checkpoints?: Record<string, string>
  /**
   * Native cut point. Claude: chain uuid of the last kept turn.
   * Pi: entry id of the user message being rewound.
   * Absent when the kept prefix has no native point.
   */
  resumeAt?: string
  /** Docked composer draft displaced by the prefill. Text only. */
  displacedDraft?: string
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
/** One open session in a workspace: a live chat pane, or a turn still running after its pane closed. */
export type ChatAgentActivity = {
  sessionId: string
  workspaceId: number
  repositoryId: number | null
  harness: AgentHarness
  status: AgentActivityStatus
  title: string
  /** `model.label` from the session, the same name the composer shows. */
  modelLabel: string
  /** Unresolved waiting request. Absent when the session is not blocked on one. */
  requestKind?: 'approval' | 'question'
  /** Present while `status` is `running` and the turn recorded a start time. */
  runningSince?: number
  /**
   * Pane to focus when several bindings exist: the active tab's pane when that is known
   * to the caller, otherwise the highest pane id. Null when the turn is unbound.
   */
  paneId: number | null
  /** Every live pane bound to this session, highest id first. Empty when unbound. */
  paneIds: number[]
}
export type ChatSearchHit = ChatAgentActivity & {
  updatedAt: number
  snippet: string
  /** Bound to a live pane, or running/waiting with no pane. */
  open: boolean
}
export type ChatSearchQuery = {
  workspaceIds: number[]
  query: string
  pastOnly: boolean
}
export type ChatSearchResult = {
  hits: ChatSearchHit[]
  /** Matches in scope before the 40-hit cap. */
  total: number
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
  action:
    | 'get'
    | 'new'
    | 'open'
    | 'send'
    | 'stop'
    | 'reply'
    | 'fork'
    | 'steer'
    | 'dequeue'
    | 'rewind'
    | 'undo'
  workspaceId: number
  paneId: number
  sessionId?: string
  /** For 'send': idempotency key. For 'steer'/'dequeue': the QueuedMessage.id to act on. */
  commandId?: string
  text?: string
  attachments?: ChatAttachmentUpload[]
  /** Skills mentioned in `text`. The host turns each name into that harness's prompt form. */
  skills?: Array<{ name: string; path?: string }>
  model?: AgentModel
  reasoning?: string
  accessMode?: AgentAccessMode
  requestId?: string
  allow?: boolean
  answers?: Record<string, string[]>
  /** Required for 'fork': the turn (section) to branch at. Everything up to and including it is copied. */
  turnId?: string
  /** Required for 'rewind': the user item the cut starts at. */
  itemId?: string
  /** Composer text replaced when a rewind prefills the prompt. Restored by undo. */
  displacedDraft?: string
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
  /** Shown on the session while a turn continues, or while idle after the runtime reports a problem. */
  | { type: 'alert'; message: string }
export type AgentAnswer = { allow: boolean; answers: Record<string, string[]> }
export type AgentRequest = NonNullable<ChatItem['request']> & { title: string; text: string }
