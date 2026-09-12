import { muxCall } from './mux'
import type {
  Project,
  ProjectBranch,
  ProjectListResult,
  Workspace,
  WorkspaceRepository
} from '../shared/types'
import { getGitHubAccessToken } from './github'
import { RepositoryService, runCommand } from './repository-service'
import { readOriginUrl, parseGitUrl } from '@cerebro/core'

export { getWorkspaceProjectId } from '@cerebro/core'
export const repositoryService = new RepositoryService({
  getToken: getGitHubAccessToken,
  apiUrl: process.env.CEREBRO_GITHUB_API_URL?.replace(/\/$/, ''),
  // Tests must opt in to a fake gh binary; never use the developer's login.
  run: (command, args, options) => {
    if (command === 'gh' && process.env.NODE_ENV === 'test' && !process.env.CEREBRO_E2E_GH_PATH)
      return Promise.reject(new Error('gh is not connected.'))
    return runCommand(
      command === 'gh'
        ? process.env.CEREBRO_E2E_GH_PATH && process.env.NODE_ENV === 'test'
          ? process.env.CEREBRO_E2E_GH_PATH
          : command
        : command,
      args,
      options
    )
  }
})
const knownRepositories = new Set<string>()

export function isTrackedRepository(owner: string, repo: string): boolean {
  return knownRepositories.has(`${owner}/${repo}`.toLowerCase())
}

// Local project/selection mutations never wait for a GitHub request.
export async function listProjects(): Promise<ProjectListResult> {
  return muxCall('registry', { action: 'list' })
}
export async function setActiveWorkspace(workspaceId: number): Promise<ProjectListResult> {
  return muxCall('registry', { action: 'select', workspaceId })
}
export async function createProjectFromGitUrl(gitUrl: string): Promise<Project> {
  return muxCall('registry', { action: 'project.create', gitUrl, provider: true })
}
export async function createProjectFromDirectory(directory: string): Promise<Project> {
  return muxCall('registry', { action: 'project.createDirectory', directory })
}
export async function createWorkspaceFromBranch(
  projectId: number,
  branch: string,
  from?: string
): Promise<Workspace> {
  return muxCall('registry', {
    action: 'workspace.create',
    projectId,
    branch,
    from,
    provider: true
  })
}
export async function removeWorkspace(
  workspaceId: number,
  deleteFiles: boolean
): Promise<ProjectListResult> {
  return muxCall('registry', { action: 'workspace.remove', workspaceId, deleteFiles })
}
export async function removeProject(
  projectId: number,
  deleteFiles: boolean
): Promise<ProjectListResult> {
  return muxCall('registry', { action: 'project.remove', projectId, deleteFiles })
}

export async function listProjectBranches(projectId: number): Promise<ProjectBranch[]> {
  const { projects } = await listProjects()
  const project = projects.find((project) => project.id === projectId)
  if (!project?.github || project.kind === 'multi-root')
    throw new Error('Worktrees require a GitHub-linked single-root project.')
  const repo = project.repositories[0]
  const names = await repositoryService.branches(
    project.github.owner,
    project.github.repo,
    repo.localPath
  )
  const existing = new Set(project.workspaces.map((workspace) => workspace.branch))
  return names.map((name) => ({ name, hasWorkspace: existing.has(name) }))
}

/** Read each checkout's current branch and remote, including .git file worktrees. */
export async function listWorkspaceRepositories(): Promise<WorkspaceRepository[]> {
  const { projects } = await listProjects()
  const result: WorkspaceRepository[] = []
  // A small pool avoids one Git process per workspace running simultaneously.
  const pending = projects.flatMap((project) =>
    project.workspaces
      .filter((workspace) => workspace.kind !== 'root')
      .map((workspace) => ({ workspace, project }))
  )
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length) {
        const item = pending.shift()!
        const { workspace, project } = item
        let branch: string | null = null
        let github: WorkspaceRepository['github'] = null
        try {
          branch = await runCommand('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
            cwd: workspace.localPath
          })
          let origin = await readOriginUrl(workspace.localPath)
          // Clones use a local fixture remote in E2E, while retaining the real repository identity.
          if (process.env.NODE_ENV === 'test' && origin?.startsWith('file:'))
            origin =
              project.repositories.find((repo) => repo.id === workspace.repositoryId)?.gitUrl ??
              origin
          github = origin ? parseGitUrl(origin).github : null
        } catch {
          /* Detached HEAD, plain folders and removed checkouts have no branch PR. */
        }
        result.push({ workspaceId: workspace.id, branch, github })
      }
    })
  )
  knownRepositories.clear()
  for (const workspace of result)
    if (workspace.github)
      knownRepositories.add(`${workspace.github.owner}/${workspace.github.repo}`.toLowerCase())
  return result.sort((a, b) => a.workspaceId - b.workspaceId)
}
