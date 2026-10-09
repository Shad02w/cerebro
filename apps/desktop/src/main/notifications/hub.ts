import type {
  AgentStatusEvent,
  AppNotification,
  NotificationAction,
  NotificationResponse
} from '@cerebro/core'

export interface NotificationChannel {
  readonly name: string
  isAvailable(): boolean
  send(notification: AppNotification): void
  dismiss(id: string): void
}

export type WorkspaceLabel = { project: string; workspace: string }

export type NotificationHubDeps = {
  /** True when a Cerebro window has OS focus. */
  isAppFocused: () => boolean
  /** True when the user is already looking at the pane (focused app, active workspace/tab/pane). */
  isTargetVisible: (target: AppNotification['target']) => Promise<boolean> | boolean
  describeWorkspace: (workspaceId: number) => Promise<WorkspaceLabel | null> | WorkspaceLabel | null
  inApp: NotificationChannel
  system: NotificationChannel
  /** Performs a user response (open the pane, allow/deny a request). */
  onResponse: (response: NotificationResponse) => Promise<void> | void
}

const ALLOW_DENY: NotificationAction[] = [
  { id: 'allow', label: 'Allow' },
  { id: 'deny', label: 'Deny' }
]

export function buildNotification(
  event: AgentStatusEvent,
  label: WorkspaceLabel | null
): AppNotification {
  const where = label ? `${label.project} / ${label.workspace}` : event.sessionTitle
  const body =
    event.kind === 'blocked'
      ? `Cerebro needs you: ${event.summary}`
      : event.kind === 'finished'
        ? `Done: ${event.summary}`
        : `Stopped: ${event.summary}`
  return {
    id: `agent:${event.sessionId}`,
    kind: event.kind,
    title: where,
    body,
    target: {
      workspaceId: event.workspaceId,
      sessionId: event.sessionId,
      paneId: event.paneId
    },
    ...(event.request ? { request: event.request } : {}),
    ...(event.kind === 'blocked' && event.request?.kind === 'approval' && event.paneId !== null
      ? { actions: ALLOW_DENY }
      : {})
  }
}

/**
 * Routes agent status events to a channel. The hub owns policy only: which channel, when to stay
 * silent, and replacing a session's previous notification. Channels own presentation.
 */
export class NotificationHub {
  private shown = new Map<string, NotificationChannel[]>()
  constructor(private deps: NotificationHubDeps) {}

  async handle(event: AgentStatusEvent): Promise<AppNotification | null> {
    const notification = buildNotification(
      event,
      await this.deps.describeWorkspace(event.workspaceId)
    )
    this.dismiss(notification.id)
    const focused = this.deps.isAppFocused()
    if (focused && (await this.deps.isTargetVisible(notification.target))) return null
    const channel = !focused && this.deps.system.isAvailable() ? this.deps.system : this.deps.inApp
    channel.send(notification)
    this.shown.set(notification.id, [channel])
    return notification
  }

  /** Removes a session's live notification from every channel that showed it. */
  dismiss(id: string): void {
    for (const channel of this.shown.get(id) ?? []) channel.dismiss(id)
    this.shown.delete(id)
  }

  async respond(response: NotificationResponse): Promise<void> {
    this.dismiss(response.notification.id)
    await this.deps.onResponse(response)
  }
}
