import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { muxCall } from './mux'

export function registerLayoutIpc(): void {
  ipcMain.handle(IPC.chat.command, async (_event, command: unknown) => {
    const delayMs = (globalThis as { __cerebroChatGetDelayMs?: number }).__cerebroChatGetDelayMs
    if (
      delayMs &&
      delayMs > 0 &&
      command != null &&
      typeof command === 'object' &&
      'action' in command &&
      (command as { action?: string }).action === 'get'
    )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    return muxCall('chat.command', command)
  })
  ipcMain.handle(IPC.chat.overview, () => muxCall('chat.overview'))
  ipcMain.handle(IPC.chat.catalog, (_event, refresh: boolean) =>
    muxCall('chat.catalog', { refresh })
  )
  ipcMain.handle(IPC.chat.favorite, (_event, key: string, favorite: boolean) =>
    muxCall('chat.favorite', { key, favorite })
  )
  ipcMain.handle(
    IPC.chat.attachment,
    (_event, workspaceId: number, sessionId: string, attachmentId: string) =>
      muxCall('chat.attachment', { workspaceId, sessionId, attachmentId })
  )
  ipcMain.handle(IPC.layout.get, () => muxCall('layout.get'))
  ipcMain.handle(IPC.layout.command, (_event, command: unknown) =>
    muxCall('layout.command', command)
  )
  ipcMain.handle(
    IPC.layout.paneState,
    (_event, workspaceId: number, paneId: number, state: unknown) =>
      muxCall('pane.state', { workspaceId, paneId, state })
  )
  ipcMain.on(IPC.layout.measure, (_event, paneId: number, width: number, height: number) => {
    void muxCall('layout.measure', { paneId, width, height }).catch(() => {})
  })
}
