import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { CerebroApi, GitHubStatus, PtyDataEvent, PtyExitEvent } from '../shared/types'

const api: CerebroApi = {
  listWorkspaces: () => ipcRenderer.invoke(IPC.workspaces.list),
  createWorkspace: (gitUrl) => ipcRenderer.invoke(IPC.workspaces.create, gitUrl),
  setActiveWorkspace: (workspaceId) => ipcRenderer.invoke(IPC.workspaces.setActive, workspaceId),
  getSettings: () => ipcRenderer.invoke(IPC.settings.get),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settings.set, patch),
  pickDirectory: () => ipcRenderer.invoke(IPC.settings.pickDirectory),
  getGitHubStatus: () => ipcRenderer.invoke(IPC.github.getStatus),
  beginGitHubDeviceFlow: () => ipcRenderer.invoke(IPC.github.beginDeviceFlow),
  cancelGitHubDeviceFlow: () => ipcRenderer.invoke(IPC.github.cancelDeviceFlow),
  disconnectGitHub: () => ipcRenderer.invoke(IPC.github.disconnect),
  onGitHubStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, status: GitHubStatus): void => {
      listener(status)
    }
    ipcRenderer.on(IPC.github.status, handler)
    return () => {
      ipcRenderer.removeListener(IPC.github.status, handler)
    }
  },
  openPty: (workspaceId, cols, rows) => ipcRenderer.invoke(IPC.pty.open, workspaceId, cols, rows),
  writePty: (sessionId, data) => ipcRenderer.invoke(IPC.pty.write, sessionId, data),
  resizePty: (sessionId, cols, rows) => ipcRenderer.invoke(IPC.pty.resize, sessionId, cols, rows),
  killPty: (sessionId) => ipcRenderer.invoke(IPC.pty.kill, sessionId),
  onPtyData: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: PtyDataEvent): void => {
      listener(payload)
    }
    ipcRenderer.on(IPC.pty.data, handler)
    return () => {
      ipcRenderer.removeListener(IPC.pty.data, handler)
    }
  },
  onPtyExit: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: PtyExitEvent): void => {
      listener(payload)
    }
    ipcRenderer.on(IPC.pty.exit, handler)
    return () => {
      ipcRenderer.removeListener(IPC.pty.exit, handler)
    }
  }
}

if (!process.contextIsolated) {
  throw new Error('Cerebro requires context isolation to be enabled.')
}

contextBridge.exposeInMainWorld('cerebro', api)
