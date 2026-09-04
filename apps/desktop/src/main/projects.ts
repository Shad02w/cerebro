import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LinkedRepository,
  Project,
  ProjectBranch,
  ProjectListResult,
  Workspace,
  WorkspaceKind
} from '../shared/types'
import { getDb, toId } from './db'
import {
  addWorktree,
  cloneRepository,
  isGitHubGitUrl,
  listRemoteBranches,
  parseGitUrl,
  sanitizeBranchForPath
} from './git'
import { fetchPullRequestsByBranchIfConnected } from './github-prs'
import { isReservedName } from './paths'
import { readGitHubToken } from './secret-store'
import { ensureCloneRoot } from './settings'
import {
  createProjectFromDirectory as coreCreateProjectFromDirectory,
  createProjectFromGitUrl as coreCreateProjectFromGitUrl,
  createWorkspaceFromBranch as coreCreateWorkspaceFromBranch,
  getWorkspaceLocalPath as coreGetWorkspaceLocalPath,
  getWorkspaceProjectId,
  listProjectBranches as coreListProjectBranches,
  listProjects as coreListProjects,
  removeProject as coreRemoveProject,
  removeWorkspace as coreRemoveWorkspace,
  setActiveWorkspace as coreSetActiveWorkspace,
  clearActiveWorkspace as coreClearActiveWorkspace
} from '@cerebro/core'

export { getWorkspaceProjectId } from '@cerebro/core'

const ACTIVE_WORKSPACE_KEY = 'active_workspace_id'

type ProjectRow = {
  id: number
  name: string
  kind: 'clone' | 'directory' | 'multi-root'
  created_at: string
  updated_at: string
}

type RepositoryRow = {
  id: number
  project_id: number
  git_url: string
  name: string
  local_path: string
  default_branch: string
  created_at: string
}

type WorkspaceRow = {
  id: number
  project_id: number
  repository_id: number
  kind: WorkspaceKind
  branch: string
  local_path: string
  created_at: string
}

function getLoginHost(): string | null {
  const raw = process.env.CEREBRO_GITHUB_LOGIN_URL?.trim()
  return raw || null
}

function mapRepository(row: RepositoryRow): LinkedRepository {
  return {
    id: row.id,
    projectId: row.project_id,
    gitUrl: row.git_url,
    name: row.name,
    localPath: row.local_path,
    defaultBranch: row.default_branch,
    createdAt: row.created_at
  }
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    projectId: row.project_id,
    repositoryId: row.repository_id,
    kind: row.kind,
    branch: row.branch,
    localPath: row.local_path,
    createdAt: row.created_at,
    pullRequest: null
  }
}

function allocateLocalPath(baseName: string): string {
  const root = ensureCloneRoot()
  const slug = isReservedName(baseName) ? `${baseName}-repo` : baseName
  let candidate = join(root, slug)
  let suffix = 2

  while (existsSync(candidate)) {
    candidate = join(root, `${slug}-${suffix}`)
    suffix += 1
  }

  return candidate
}

function getActiveWorkspaceId(db = getDb()): number | null {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(ACTIVE_WORKSPACE_KEY) as
    { value: string } | undefined
  if (!row) return null
  const id = Number(row.value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function setActiveWorkspaceId(workspaceId: number, db = getDb()): void {
  db.prepare(
    `
      INSERT INTO app_state (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run(ACTIVE_WORKSPACE_KEY, String(workspaceId))
}

function loadProjectsFromDb(): {
  projects: Project[]
  activeWorkspaceId: number | null
} {
  const db = getDb()
  const projectRows = db
    .prepare(
      'SELECT id, name, kind, created_at, updated_at FROM projects ORDER BY created_at DESC, id DESC'
    )
    .all() as ProjectRow[]
  const repositoryRows = db
    .prepare(
      `
        SELECT id, project_id, git_url, name, local_path, default_branch, created_at
        FROM repositories
        ORDER BY created_at ASC, id ASC
      `
    )
    .all() as RepositoryRow[]
  const workspaceRows = db
    .prepare(
      `
        SELECT id, project_id, repository_id, kind, branch, local_path, created_at
        FROM workspaces
        ORDER BY
          CASE kind WHEN 'default' THEN 0 ELSE 1 END ASC,
          created_at ASC,
          id ASC
      `
    )
    .all() as WorkspaceRow[]

  const reposByProject = new Map<number, LinkedRepository[]>()
  for (const row of repositoryRows) {
    const list = reposByProject.get(row.project_id) ?? []
    list.push(mapRepository(row))
    reposByProject.set(row.project_id, list)
  }

  const workspacesByProject = new Map<number, Workspace[]>()
  for (const row of workspaceRows) {
    const list = workspacesByProject.get(row.project_id) ?? []
    list.push(mapWorkspace(row))
    workspacesByProject.set(row.project_id, list)
  }

  const projects = projectRows.map((row) => {
    const repositories = reposByProject.get(row.id) ?? []
    const primary = repositories[0] ?? null
    const parsed = primary ? parseGitUrl(primary.gitUrl) : null
    const github =
      primary && isGitHubGitUrl(primary.gitUrl, getLoginHost()) ? (parsed?.github ?? null) : null

    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      repositories,
      workspaces: workspacesByProject.get(row.id) ?? [],
      github
    } satisfies Project
  })

  const activeWorkspaceId = getActiveWorkspaceId(db)
  const allWorkspaceIds = new Set(
    projects.flatMap((project) => project.workspaces.map((w) => w.id))
  )
  const resolvedActive =
    activeWorkspaceId != null && allWorkspaceIds.has(activeWorkspaceId) ? activeWorkspaceId : null

  return { projects, activeWorkspaceId: resolvedActive }
}

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
          pullRequest: byBranch.get(workspace.branch) ?? null
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

function getPrimaryRepository(projectId: number): RepositoryRow {
  const db = getDb()
  const repository = db
    .prepare(
      `
        SELECT id, project_id, git_url, name, local_path, default_branch, created_at
        FROM repositories
        WHERE project_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `
    )
    .get(projectId) as RepositoryRow | undefined

  if (!repository) {
    throw new Error('Project has no linked repository.')
  }
  return repository
}

export async function listProjectBranches(projectId: number): Promise<ProjectBranch[]> {
  const token = readGitHubToken()
  return (await coreListProjectBranches(projectId, { githubToken: token })) as unknown as ProjectBranch[]
}

export async function createWorkspaceFromBranch(
  projectId: number,
  branch: string
): Promise<Workspace> {
  const token = readGitHubToken()
  const created = await coreCreateWorkspaceFromBranch(projectId, branch, { githubToken: token })

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
