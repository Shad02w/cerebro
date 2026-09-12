import { muxRequest } from '@cerebro/mux'
import type { Project, ProjectListResult, Workspace } from '@cerebro/core'
export const listProjects = (): Promise<ProjectListResult> =>
  muxRequest('registry', { action: 'list' })
export const createProjectFromDirectory = (directory: string): Promise<Project> =>
  muxRequest('registry', { action: 'project.createDirectory', directory })
export const createProjectFromGitUrl = (gitUrl: string): Promise<Project> =>
  muxRequest('registry', { action: 'project.create', gitUrl })
export const createWorkspaceFromBranch = (
  projectId: number,
  branch: string,
  options?: { from?: string | null }
): Promise<Workspace> =>
  muxRequest('registry', { action: 'workspace.create', projectId, branch, from: options?.from })
export const removeWorkspace = (
  workspaceId: number,
  options: { deleteFiles: boolean }
): Promise<ProjectListResult> =>
  muxRequest('registry', { action: 'workspace.remove', workspaceId, ...options })
export const removeProject = (
  projectId: number,
  options: { deleteFiles: boolean }
): Promise<ProjectListResult> =>
  muxRequest('registry', { action: 'project.remove', projectId, ...options })
export async function getWorkspaceLocalPath(workspaceId: number): Promise<string> {
  const workspace = (await listProjects()).projects
    .flatMap((project) => project.workspaces)
    .find((workspace) => workspace.id === workspaceId)
  if (!workspace) throw new Error('Workspace not found.')
  return workspace.localPath
}
