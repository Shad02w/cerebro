import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import type { NativeCommandId } from '../shared/types'

const NATIVE_COMMANDS = new Set<NativeCommandId>(['closeWindow', 'toggleDevTools'])

function windowFromSender(sender: WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender)
}

export function runNativeCommand(sender: WebContents, command: NativeCommandId): void {
  const window = windowFromSender(sender)
  if (!window || window.isDestroyed()) return

  switch (command) {
    case 'closeWindow':
      window.close()
      return
    case 'toggleDevTools':
      window.webContents.toggleDevTools()
      return
    default: {
      const _exhaustive: never = command
      void _exhaustive
    }
  }
}

export function registerNativeCommandIpc(): void {
  ipcMain.handle(IPC.native.runCommand, (event, command: unknown) => {
    if (typeof command !== 'string' || !NATIVE_COMMANDS.has(command as NativeCommandId)) {
      throw new Error('Unknown native command.')
    }
    runNativeCommand(event.sender, command as NativeCommandId)
  })
}
