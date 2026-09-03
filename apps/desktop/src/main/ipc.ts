import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { chooseCloneLocation, getCloneLocation, setCloneLocation } from './settings'
import { createWorkspaceFromGitUrl, listWorkspaces, setActiveWorkspace } from './workspaces'

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong.'
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle(IPC.workspaces.list, () => listWorkspaces())

  ipcMain.handle(IPC.workspaces.create, async (_event, gitUrl: unknown) => {
    if (typeof gitUrl !== 'string') {
      throw new Error('Git URL is required.')
    }
    try {
      return await createWorkspaceFromGitUrl(gitUrl)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(IPC.workspaces.setActive, (_event, workspaceId: unknown) => {
    if (typeof workspaceId !== 'number' || !Number.isInteger(workspaceId)) {
      throw new Error('Workspace id is required.')
    }
    return setActiveWorkspace(workspaceId)
  })
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settings.getCloneLocation, () => getCloneLocation())

  ipcMain.handle(IPC.settings.setCloneLocation, (_event, location: unknown) => {
    if (typeof location !== 'string') {
      throw new Error('Clone location is required.')
    }
    try {
      return setCloneLocation(location)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle(IPC.settings.chooseCloneLocation, async (event) => {
    try {
      return await chooseCloneLocation(event)
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })
}
