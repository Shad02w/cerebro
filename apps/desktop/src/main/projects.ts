import type { Project, ProjectBranch, ProjectListResult, Workspace } from '../shared/types'
import { fetchPullRequestsByBranchIfConnected } from './github-prs'
import { readGitHubToken } from './secret-store'
import {
  createProjectFromDirectory as coreCreateProjectFromDirectory,
  createProjectFromGitUrl as coreCreateProjectFromGitUrl,
  createWorkspaceFromBranch as coreCreateWorkspaceFromBranch,
  getWorkspaceLocalPath as coreGetWorkspaceLocalPath,
  listProjectBranches as coreListProjectBranches,
  listProjects as coreListProjects,
  removeProject as coreRemoveProject,
  removeWorkspace as coreRemoveWorkspace,
  setActiveWorkspace as coreSetActiveWorkspace,
  clearActiveWorkspace as coreClearActiveWorkspace
} from '@cerebro/core'

export { getWorkspaceProjectId } from '@cerebro/core'

async function attachPullRequests(projects: Project[]): Promise<Project[]> {
  const token = readGitHubToken()
  if (!token) return projects

  return Promise.all(
    projects.map(async (project) => {
      if (!project.github) return project
      const byBranch = await fetchPullRequestsByBranchIfConnected(
        project.github.owner,
        project.github.repo
      )
      if (byBranch.size === 0) return project
      return {
        ...project,
        workspaces: project.workspaces.map((workspace) => ({
          ...workspace,
          pullRequest: workspace.kind === 'root' ? null : (byBranch.get(workspace.branch) ?? null)
        }))
      }
    })
  )
}

export async function listProjects(): Promise<ProjectListResult> {
  const base = await coreListProjects()
  const withPrs = await attachPullRequests(base.projects as unknown as Project[])
  return { projects: withPrs, activeWorkspaceId: base.activeWorkspaceId }
}

export async function setActiveWorkspace(workspaceId: number): Promise<ProjectListResult> {
  const base = await coreSetActiveWorkspace(workspaceId)
  const withPrs = await attachPullRequests(base.projects as unknown as Project[])
  return { projects: withPrs, activeWorkspaceId: base.activeWorkspaceId }
}

export function clearActiveWorkspace(): void {
  coreClearActiveWorkspace()
}

/** Absolute checkout path for a workspace (default clone or worktree). */
export function getWorkspaceLocalPath(workspaceId: number): string {
  return coreGetWorkspaceLocalPath(workspaceId)
}

export async function createProjectFromGitUrl(gitUrl: string): Promise<Project> {
  const token = readGitHubToken()
  const project = await coreCreateProjectFromGitUrl(gitUrl, { githubToken: token })
  const withPrs = await attachPullRequests([project as unknown as Project])
  const result = withPrs[0]
  if (!result) throw new Error('Project was created but could not be loaded.')
  return result
}

export async function createProjectFromDirectory(directory: string): Promise<Project> {
  const project = await coreCreateProjectFromDirectory(directory)
  const withPrs = await attachPullRequests([project as unknown as Project])
  const result = withPrs[0]
  if (!result) throw new Error('Project was created but could not be loaded.')
  return result
}

export async function listProjectBranches(projectId: number): Promise<ProjectBranch[]> {
  const token = readGitHubToken()
  return (await coreListProjectBranches(projectId, {
    githubToken: token
  })) as unknown as ProjectBranch[]
}

export async function createWorkspaceFromBranch(
  projectId: number,
  branch: string,
  from?: string
): Promise<Workspace> {
  const token = readGitHubToken()
  const created = await coreCreateWorkspaceFromBranch(projectId, branch, {
    githubToken: token,
    from
  })

  const listed = await listProjects()
  const workspace = listed.projects
    .flatMap((item) => item.workspaces)
    .find((item) => item.id === created.id)
  if (!workspace) throw new Error('Workspace was created but could not be loaded.')
  return workspace
}

export async function removeWorkspace(
  workspaceId: number,
  deleteFiles: boolean
): Promise<ProjectListResult> {
  const base = await coreRemoveWorkspace(workspaceId, { deleteFiles })
  const withPrs = await attachPullRequests(base.projects as unknown as Project[])
  return { projects: withPrs, activeWorkspaceId: base.activeWorkspaceId }
}

export async function removeProject(
  projectId: number,
  deleteFiles: boolean
): Promise<ProjectListResult> {
  const base = await coreRemoveProject(projectId, { deleteFiles })
  const withPrs = await attachPullRequests(base.projects as unknown as Project[])
  return { projects: withPrs, activeWorkspaceId: base.activeWorkspaceId }
}
