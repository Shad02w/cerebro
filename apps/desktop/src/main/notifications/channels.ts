import { app, BrowserWindow, Notification } from 'electron'
import type { AppNotification } from '@cerebro/core'
import { IPC } from '../../shared/ipc'
import type { NotificationChannel } from './hub'

export function createInAppChannel(): NotificationChannel {
  const send = (channel: string, data: unknown): void => {
    for (const win of BrowserWindow.getAllWindows())
      if (!win.isDestroyed()) win.webContents.send(channel, data)
  }
  return {
    name: 'in-app',
    isAvailable: () => BrowserWindow.getAllWindows().length > 0,
    send: (notification) => send(IPC.notify.show, notification),
    dismiss: (id) => send(IPC.notify.dismiss, id)
  }
}

export function createMacSystemChannel(
  onOpen: (notification: AppNotification) => void,
  onAction: (notification: AppNotification, actionId: 'allow' | 'deny') => void
): NotificationChannel {
  const live = new Map<string, Notification>()
  return {
    name: 'system',
    // Playwright cannot observe OS notifications, so e2e runs exercise the in-app path.
    isAvailable: () =>
      process.platform === 'darwin' &&
      process.env.NODE_ENV !== 'test' &&
      Notification.isSupported(),
    send: (notification) => {
      const native = new Notification({
        title: notification.title,
        body: notification.body,
        silent: notification.kind === 'finished',
        // macOS only renders these in the "Alerts" style; click-to-open is the primary path.
        ...(notification.actions
          ? {
              actions: notification.actions.map((a) => ({ type: 'button' as const, text: a.label }))
            }
          : {})
      })
      native.on('click', () => onOpen(notification))
      native.on('action', (_event, index) => {
        const action = notification.actions?.[index]
        if (action) onAction(notification, action.id)
      })
      native.on('close', () => {
        if (live.get(notification.id) === native) live.delete(notification.id)
      })
      live.set(notification.id, native)
      native.show()
      if (notification.kind === 'blocked') app.dock?.bounce('critical')
    },
    dismiss: (id) => {
      live.get(id)?.close()
      live.delete(id)
    }
  }
}
