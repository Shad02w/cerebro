import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { muxCall } from './mux'
export function registerLayoutIpc(): void {
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
