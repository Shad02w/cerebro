import { app, BrowserWindow, ipcMain } from 'electron'
import type { AppNotification, NotificationResponse } from '@cerebro/core'
import { IPC } from '../../shared/ipc'
import { focusWorkspaceInUi, getCachedLayout, muxCall, onAgentStatus } from '../mux'
import { listProjects, setActiveWorkspace } from '../projects'
import { createInAppChannel, createMacSystemChannel } from './channels'
import { NotificationHub, type WorkspaceLabel } from './hub'

function appWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
}

function revealWindow(): void {
  const win = appWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  app.focus({ steal: true })
}

async function describeWorkspace(workspaceId: number): Promise<WorkspaceLabel | null> {
  const { projects } = await listProjects()
  for (const project of projects) {
    const workspace = project.workspaces.find((w) => w.id === workspaceId)
    if (workspace)
      return { project: project.name, workspace: workspace.displayName ?? workspace.branch }
  }
  return null
}

async function isTargetVisible(target: AppNotification['target']): Promise<boolean> {
  if (target.paneId === null) return false
  const { activeWorkspaceId } = await listProjects()
  if (activeWorkspaceId !== target.workspaceId) return false
  const tabs = getCachedLayout().workspaces[target.workspaceId]
  const tab = tabs?.tabs.find((t) => t.id === tabs.activeTabId)
  return tab?.activePaneId === target.paneId
}

async function focusTarget(target: AppNotification['target']): Promise<void> {
  revealWindow()
  if (target.paneId !== null) {
    await muxCall('layout.command', {
      target: 'pane',
      action: 'focus',
      workspaceId: target.workspaceId,
      paneId: target.paneId
    })
  } else {
    await setActiveWorkspace(target.workspaceId)
    focusWorkspaceInUi(target.workspaceId)
  }
}

async function handleResponse(response: NotificationResponse): Promise<void> {
  const { target, request } = response.notification
  if (response.type === 'action' && request && target.paneId !== null) {
    await muxCall('chat.command', {
      action: 'reply',
      workspaceId: target.workspaceId,
      paneId: target.paneId,
      requestId: request.id,
      allow: response.actionId === 'allow',
      answers: {}
    })
    return
  }
  await focusTarget(target)
}

function isResponse(value: unknown): value is NotificationResponse {
  const v = value as NotificationResponse | undefined
  return (
    (v?.type === 'open' || v?.type === 'action') &&
    typeof v.notification?.id === 'string' &&
    typeof v.notification.target?.workspaceId === 'number'
  )
}

export function registerNotifications(): void {
  const hub: NotificationHub = new NotificationHub({
    isAppFocused: () => appWindow()?.isFocused() ?? false,
    isTargetVisible,
    describeWorkspace,
    inApp: createInAppChannel(),
    system: createMacSystemChannel(
      (notification) => void hub.respond({ type: 'open', notification }),
      (notification, actionId) => void hub.respond({ type: 'action', notification, actionId })
    ),
    onResponse: (response) =>
      handleResponse(response).catch((error) => console.error('[notifications]', error))
  })
  onAgentStatus((event) => {
    void hub.handle(event).catch((error) => console.error('[notifications]', error))
  })
  ipcMain.handle(IPC.notify.respond, async (_event, response: unknown) => {
    if (isResponse(response)) await hub.respond(response)
  })
}
