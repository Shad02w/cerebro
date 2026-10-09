import type { NotificationResponse } from '@cerebro/core'

export type ResponseDeps = {
  revealWindow: () => void
  muxCall: (method: string, params: unknown) => Promise<unknown>
  setActiveWorkspace: (workspaceId: number) => Promise<void>
  focusWorkspaceInUi: (workspaceId: number) => void
}

/** Turns a user response into mux commands. Electron-free so it can be tested directly. */
export function createResponseHandler(deps: ResponseDeps) {
  return async (response: NotificationResponse): Promise<void> => {
    const { target, request } = response.notification
    if (response.type === 'action' && request && target.paneId !== null) {
      await deps.muxCall('chat.command', {
        action: 'reply',
        workspaceId: target.workspaceId,
        paneId: target.paneId,
        requestId: request.id,
        allow: response.actionId === 'allow',
        answers: {}
      })
      return
    }
    deps.revealWindow()
    if (target.paneId !== null) {
      await deps.muxCall('layout.command', {
        target: 'pane',
        action: 'focus',
        workspaceId: target.workspaceId,
        paneId: target.paneId
      })
    } else {
      await deps.setActiveWorkspace(target.workspaceId)
      deps.focusWorkspaceInUi(target.workspaceId)
    }
  }
}
