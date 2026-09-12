import { registerLayoutIpc, removeWorkspaceLayout } from './panes'
import { ipcMain, shell } from 'electron'
import { getWorkspaceFileDiff, isChangedFileStatus, listWorkspaceChanges } from '@cerebro/core'
import { IPC } from '../shared/ipc'
import type { AppSettingsPatch, ChangedFile } from '../shared/types'
import { registerGitHubIpc } from './github'
import { killPtyForWorkspace, registerPtyIpc } from './pty'
import {
  createProjectFromDirectory,
  createProjectFromGitUrl,
  createWorkspaceFromBranch,
  listProjectBranches,
  listWorkspaceRepositories,
  repositoryService,
  isTrackedRepository,
  listProjects,
  removeProject,
  removeWorkspace,
  setActiveWorkspace
} from './projects'
import { getSettings, pickDirectory, pickProjectDirectory, setSettings } from './settings'

function parseChangedFile(file: unknown): ChangedFile {
  if (!file || typeof file !== 'object') {
    throw new Error('Changed file is required.')
  }
  const record = file as {
    path?: unknown
    oldPath?: unknown
    status?: unknown
  }
  if (typeof record.path !== 'string' || !record.path.trim()) {
    throw new Error('Changed file path is required.')
  }
  const status = record.status
  if (!isChangedFileStatus(status)) {
    throw new Error('Changed file status is required.')
  }
  if (record.oldPath != null && typeof record.oldPath !== 'string') {
    throw new Error('Changed file old path is invalid.')
  }
  return {
    path: record.path,
    oldPath: typeof record.oldPath === 'string' ? record.oldPath : null,
    status
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : 'Something went wrong.'
  if (/not a git repository/i.test(message)) {
    return 'This folder looks like a git repository, but Git could not open it. If it is a submodule, initialize it first, or choose a different folder.'
  }
  return message
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settings.get, () => getSettings())

  ipcMain.handle(IPC.settings.set, (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') {
      throw new Error('Settings patch is required.')
    }
    try {
      return setSettings(patch as AppSettingsPatch)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(IPC.settings.pickDirectory, async (event) => {
    try {
      return await pickDirectory(event.sender)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle(IPC.repositories.workspaces, () => listWorkspaceRepositories())
  ipcMain.handle(IPC.repositories.pullRequests, async (_event, owner: unknown, repo: unknown) => {
    if (
      typeof owner !== 'string' ||
      typeof repo !== 'string' ||
      !/^[A-Za-z0-9_.-]+$/.test(owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(repo)
    )
      throw new Error('Invalid repository identity.')
    if (!isTrackedRepository(owner, repo)) await listWorkspaceRepositories()
    if (!isTrackedRepository(owner, repo)) throw new Error('Repository is not tracked by Cerebro.')
    return repositoryService.pullRequests(owner, repo)
  })
  ipcMain.handle(IPC.projects.list, async () => {
    try {
      return await listProjects()
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(IPC.projects.create, async (_event, gitUrl: unknown) => {
    if (typeof gitUrl !== 'string') {
      throw new Error('Git URL is required.')
    }
    try {
      return await createProjectFromGitUrl(gitUrl)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(IPC.projects.createFromDirectory, async (_event, directory: unknown) => {
    if (typeof directory !== 'string' || !directory.trim()) {
      throw new Error('Directory is required.')
    }
    try {
      return await createProjectFromDirectory(directory)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(IPC.projects.pickDirectory, async (event) => {
    try {
      return await pickProjectDirectory(event.sender)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(IPC.projects.listBranches, async (_event, projectId: unknown) => {
    if (typeof projectId !== 'number' || !Number.isInteger(projectId)) {
      throw new Error('Project id is required.')
    }
    try {
      return await listProjectBranches(projectId)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(IPC.workspaces.setActive, async (_event, workspaceId: unknown) => {
    if (typeof workspaceId !== 'number' || !Number.isInteger(workspaceId)) {
      throw new Error('Workspace id is required.')
    }
    try {
      return await setActiveWorkspace(workspaceId)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(
    IPC.workspaces.create,
    async (_event, projectId: unknown, branch: unknown, from: unknown) => {
      if (typeof projectId !== 'number' || !Number.isInteger(projectId)) {
        throw new Error('Project id is required.')
      }
      if (typeof branch !== 'string') {
        throw new Error('Branch name is required.')
      }
      const fromBranch = typeof from === 'string' && from.trim() ? from.trim() : undefined
      try {
        return await createWorkspaceFromBranch(projectId, branch, fromBranch)
      } catch (error) {
        throw new Error(errorMessage(error))
      }
    }
  )

  ipcMain.handle(
    IPC.workspaces.remove,
    async (_event, workspaceId: unknown, deleteFiles: unknown) => {
      if (typeof workspaceId !== 'number' || !Number.isInteger(workspaceId)) {
        throw new Error('Workspace id is required.')
      }
      if (typeof deleteFiles !== 'boolean') {
        throw new Error('deleteFiles is required.')
      }
      try {
        killPtyForWorkspace(workspaceId)
        const result = await removeWorkspace(workspaceId, deleteFiles)
        removeWorkspaceLayout(workspaceId)
        return result
      } catch (error) {
        throw new Error(errorMessage(error))
      }
    }
  )

  ipcMain.handle(IPC.workspaces.listChanges, async (_event, workspaceId: unknown) => {
    if (typeof workspaceId !== 'number' || !Number.isInteger(workspaceId)) {
      throw new Error('Workspace id is required.')
    }
    try {
      return await listWorkspaceChanges(workspaceId)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(
    IPC.workspaces.getFileDiff,
    async (_event, workspaceId: unknown, repositoryId: unknown, file: unknown) => {
      if (typeof workspaceId !== 'number' || !Number.isInteger(workspaceId)) {
        throw new Error('Workspace id is required.')
      }
      if (typeof repositoryId !== 'number' || !Number.isInteger(repositoryId)) {
        throw new Error('Repository id is required.')
      }
      const changed = parseChangedFile(file)
      try {
        return await getWorkspaceFileDiff(workspaceId, repositoryId, changed)
      } catch (error) {
        throw new Error(errorMessage(error))
      }
    }
  )

  ipcMain.handle(IPC.projects.remove, async (_event, projectId: unknown, deleteFiles: unknown) => {
    if (typeof projectId !== 'number' || !Number.isInteger(projectId)) {
      throw new Error('Project id is required.')
    }
    if (typeof deleteFiles !== 'boolean') {
      throw new Error('deleteFiles is required.')
    }
    try {
      const listed = await listProjects()
      const project = listed.projects.find((item) => item.id === projectId)
      if (project) {
        for (const workspace of project.workspaces) {
          killPtyForWorkspace(workspace.id)
        }
      }
      const result = await removeProject(projectId, deleteFiles)
      for (const workspace of project?.workspaces ?? []) removeWorkspaceLayout(workspace.id)
      return result
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(IPC.shell.openExternal, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('URL is required.')
    }
    const trimmed = url.trim()
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error('Only http(s) URLs can be opened.')
    }
    if (process.env.NODE_ENV !== 'test') await shell.openExternal(trimmed)
  })

  registerGitHubIpc(ipcMain)
  registerPtyIpc()
  registerLayoutIpc()
}
