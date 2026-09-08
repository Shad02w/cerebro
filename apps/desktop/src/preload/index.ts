import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  CerebroApi,
  GitHubStatus,
  NativeCommandId,
  PtyDataEvent,
  PtyExitEvent
} from '../shared/types'

const api: CerebroApi = {
  getLayout: () => ipcRenderer.invoke(IPC.layout.get),
  onLayoutFocusWorkspace: (listener) => {
    const handler = (_event: IpcRendererEvent, workspaceId: number): void => listener(workspaceId)
    ipcRenderer.on(IPC.layout.focusWorkspace, handler)
    return () => {
      ipcRenderer.removeListener(IPC.layout.focusWorkspace, handler)
    }
  },
  layoutCommand: (command) => ipcRenderer.invoke(IPC.layout.command, command),
  measurePane: (paneId, width, height) =>
    ipcRenderer.send(IPC.layout.measure, paneId, width, height),
  onLayoutChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, state: Parameters<typeof listener>[0]): void =>
      listener(state)
    ipcRenderer.on(IPC.layout.changed, handler)
    return () => {
      ipcRenderer.removeListener(IPC.layout.changed, handler)
    }
  },
  listProjects: () => ipcRenderer.invoke(IPC.projects.list),
  createProject: (gitUrl) => ipcRenderer.invoke(IPC.projects.create, gitUrl),
  createProjectFromDirectory: (directory) =>
    ipcRenderer.invoke(IPC.projects.createFromDirectory, directory),
  pickProjectDirectory: () => ipcRenderer.invoke(IPC.projects.pickDirectory),
  removeProject: (projectId, deleteFiles) =>
    ipcRenderer.invoke(IPC.projects.remove, projectId, deleteFiles),
  setActiveWorkspace: (workspaceId) => ipcRenderer.invoke(IPC.workspaces.setActive, workspaceId),
  createWorkspace: (projectId, branch, from) =>
    ipcRenderer.invoke(IPC.workspaces.create, projectId, branch, from ?? null),
  removeWorkspace: (workspaceId, deleteFiles) =>
    ipcRenderer.invoke(IPC.workspaces.remove, workspaceId, deleteFiles),
  listProjectBranches: (projectId) => ipcRenderer.invoke(IPC.projects.listBranches, projectId),
  listWorkspaceChanges: (workspaceId) =>
    ipcRenderer.invoke(IPC.workspaces.listChanges, workspaceId),
  getWorkspaceFileDiff: (workspaceId, repositoryId, file) =>
    ipcRenderer.invoke(IPC.workspaces.getFileDiff, workspaceId, repositoryId, file),
  openExternal: (url) => ipcRenderer.invoke(IPC.shell.openExternal, url),
  getSettings: () => ipcRenderer.invoke(IPC.settings.get),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settings.set, patch),
  pickDirectory: () => ipcRenderer.invoke(IPC.settings.pickDirectory),
  runNativeCommand: (command: NativeCommandId) =>
    ipcRenderer.invoke(IPC.native.runCommand, command),
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
  onProjectsInvalidate: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(IPC.projects.invalidate, handler)
    return () => {
      ipcRenderer.removeListener(IPC.projects.invalidate, handler)
    }
  },
  onMenuClose: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(IPC.keybinds.menuClose, handler)
    return () => {
      ipcRenderer.removeListener(IPC.keybinds.menuClose, handler)
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
