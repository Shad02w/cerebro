export type LinkedRepository = {
  id: number
  workspaceId: number
  gitUrl: string
  name: string
  localPath: string
  defaultBranch: string
  createdAt: string
}

export type Workspace = {
  id: number
  name: string
  createdAt: string
  updatedAt: string
  repositories: LinkedRepository[]
}

export type WorkspaceListResult = {
  workspaces: Workspace[]
  activeWorkspaceId: number | null
}

export type CerebroApi = {
  listWorkspaces: () => Promise<WorkspaceListResult>
  createWorkspace: (gitUrl: string) => Promise<Workspace>
  setActiveWorkspace: (workspaceId: number) => Promise<WorkspaceListResult>
  getCloneLocation: () => Promise<string>
  setCloneLocation: (location: string) => Promise<string>
  chooseCloneLocation: () => Promise<string | null>
}
