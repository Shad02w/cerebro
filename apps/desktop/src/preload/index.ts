import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CerebroApi } from '../shared/types'

const api: CerebroApi = {
  listWorkspaces: () => ipcRenderer.invoke(IPC.workspaces.list),
  createWorkspace: (gitUrl) => ipcRenderer.invoke(IPC.workspaces.create, gitUrl),
  setActiveWorkspace: (workspaceId) => ipcRenderer.invoke(IPC.workspaces.setActive, workspaceId)
}

if (!process.contextIsolated) {
  throw new Error('Cerebro requires context isolation to be enabled.')
}

contextBridge.exposeInMainWorld('cerebro', api)
