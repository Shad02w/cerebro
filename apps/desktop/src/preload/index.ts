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
  chatCommand: (command) => ipcRenderer.invoke(IPC.chat.command, command),
  agentCatalog: (refresh) => ipcRenderer.invoke(IPC.chat.catalog, refresh),
  agentFavorite: (key, favorite) => ipcRenderer.invoke(IPC.chat.favorite, key, favorite),
  chatAttachment: (workspaceId, sessionId, attachmentId) =>
    ipcRenderer.invoke(IPC.chat.attachment, workspaceId, sessionId, attachmentId),
  onChatChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, data: { workspaceId?: number }): void =>
      listener(data)
    ipcRenderer.on(IPC.chat.changed, handler)
    return () => {
      ipcRenderer.removeListener(IPC.chat.changed, handler)
    }
  },
  listWorkspaceRepositories: () => ipcRenderer.invoke(IPC.repositories.workspaces),
  getRepositoryPullRequests: (owner, repo) =>
    ipcRenderer.invoke(IPC.repositories.pullRequests, owner, repo),
  onWindowFocus: (listener) => {
    const handler = (_event: IpcRendererEvent, focused: boolean): void => listener(focused)
    ipcRenderer.on(IPC.native.focus, handler)
    return () => {
      ipcRenderer.removeListener(IPC.native.focus, handler)
    }
  },
  getCliStatus: () => ipcRenderer.invoke(IPC.cli.status),
  installCli: () => ipcRenderer.invoke(IPC.cli.install),
  removeCli: () => ipcRenderer.invoke(IPC.cli.remove),
  setPaneState: (workspaceId, paneId, state) =>
    ipcRenderer.invoke(IPC.layout.paneState, workspaceId, paneId, state),
  restartPty: (workspaceId, paneId) => ipcRenderer.invoke(IPC.pty.restart, workspaceId, paneId),
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
  listWorkspaceChanges: (workspaceId, repositoryId) =>
    ipcRenderer.invoke(IPC.workspaces.listChanges, workspaceId, repositoryId),
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
  openPty: (workspaceId, paneId) => ipcRenderer.invoke(IPC.pty.open, workspaceId, paneId),
  ackPty: (sessionId, sequence) => ipcRenderer.send(IPC.pty.ack, sessionId, sequence),
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
