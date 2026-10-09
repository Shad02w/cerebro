/** Transition of an agent session that may deserve the user's attention. Emitted by the mux. */
export type AgentStatusEvent = {
  kind: 'blocked' | 'finished' | 'failed'
  workspaceId: number
  sessionId: string
  /** Open chat pane bound to the session, if any. */
  paneId: number | null
  sessionTitle: string
  /** Short human text: the request, the last reply, or the error. */
  summary: string
  /** The exact command or action awaiting approval, shown as code. */
  command?: string
  /** Set for `blocked`. */
  request?: { id: string; kind: 'approval' | 'question' }
  at: number
}

export type NotificationTarget = {
  workspaceId: number
  sessionId: string
  paneId: number | null
}

export type NotificationAction = { id: 'allow' | 'deny'; label: string }

export type AppNotification = {
  /** Stable per session so a newer notification replaces the older one. */
  id: string
  kind: AgentStatusEvent['kind']
  title: string
  body: string
  /** Shown in a code block on in-app cards. */
  command?: string
  target: NotificationTarget
  request?: AgentStatusEvent['request']
  actions?: NotificationAction[]
}

export type NotificationResponse =
  | { type: 'open'; notification: AppNotification }
  | { type: 'action'; notification: AppNotification; actionId: NotificationAction['id'] }
