import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  LinkedRepository,
  Project,
  ProjectBranch,
  ProjectKind,
  ProjectListResult,
  Workspace,
  WorkspaceKind
} from './types'
import { getDb, toId } from './db'
import {
  addWorktree,
  cloneRepository,
  isGitHubGitUrl,
  listRemoteBranches,
  parseGitUrl,
  readDefaultBranch,
  readOriginUrl,
  removeWorktree,
  sanitizeBranchForPath
} from './git'
import { isReservedName } from './paths'
import { ensureCloneRoot } from './settings'

const ACTIVE_WORKSPACE_KEY = 'active_workspace_id'

type ProjectRow = {
  id: number
  name: string
  kind: ProjectKind
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

function tryParseGitUrl(url: string): ReturnType<typeof parseGitUrl> | null {
  try {
    return parseGitUrl(url)
  } catch {
    return null
  }
}

function readGitdirPointer(workTree: string): string | null {
  const gitPath = join(workTree, '.git')
  if (!existsSync(gitPath)) return null
  try {
    if (!statSync(gitPath).isFile()) return null
    const contents = readFileSync(gitPath, 'utf8')
    const match = contents.match(/^gitdir:\s*(.+)$/m)
    if (!match?.[1]) return null
    const gitdir = match[1].trim()
    return isAbsolute(gitdir) ? gitdir : resolve(workTree, gitdir)
  } catch {
    return null
  }
}

/** True when Git can actually use this folder (rejects broken / uninitialized submodules). */
function isUsableGitWorkTree(dir: string): boolean {
  const gitPath = join(dir, '.git')
  if (!existsSync(gitPath)) return false
  try {
    const stats = statSync(gitPath)
    if (stats.isDirectory()) return existsSync(join(gitPath, 'HEAD'))
    if (stats.isFile()) {
      const gitdir = readGitdirPointer(dir)
      return gitdir != null && existsSync(join(gitdir, 'HEAD'))
    }
  } catch {
    return false
  }
  return false
}

function directoryImportError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return new Error(
      'This folder looks like a git repository, but Git could not open it. If it is a submodule, initialize it first, or choose a different folder.'
    )
  }
  return error instanceof Error ? error : new Error(message)
}

async function tryDescribeGitRepository(localPath: string): Promise<DiscoveredRepository | null> {
  try {
    return await describeGitRepository(localPath)
  } catch {
    return null
  }
}

function resolveExistingDirectory(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Directory is required.')
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(trimmed)
  if (!existsSync(absolute)) throw new Error('That directory does not exist.')
  if (!statSync(absolute).isDirectory()) throw new Error('Choose a directory, not a file.')
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

function looksLikeGitCheckout(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

type DiscoveredRepository = {
  gitUrl: string
  name: string
  localPath: string
  defaultBranch: string
}

function describeLocalDirectory(localPath: string): DiscoveredRepository {
  return {
    gitUrl: pathToFileURL(localPath).href,
    name: basename(localPath),
    localPath,
    defaultBranch: ''
  }
}

function listImmediateGitCheckouts(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true })
  const repos: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const child = join(root, entry.name)
    let stats
    try {
      stats = statSync(child)
    } catch {
      continue
    }
    if (!stats.isDirectory()) continue
    if (looksLikeGitCheckout(child)) repos.push(child)
  }

  repos.sort((a, b) => basename(a).localeCompare(basename(b)))
  return repos
}

async function describeCheckout(localPath: string): Promise<DiscoveredRepository> {
  if (isUsableGitWorkTree(localPath)) {
    const repo = await tryDescribeGitRepository(localPath)
    if (repo) return repo
  }
  return describeLocalDirectory(localPath)
}

async function describeGitRepository(localPath: string): Promise<DiscoveredRepository> {
  const defaultBranch = await readDefaultBranch(localPath)
  const origin = await readOriginUrl(localPath)
  return {
    gitUrl: origin || pathToFileURL(localPath).href,
    name: basename(localPath),
    localPath,
    defaultBranch
  }
}

function uniquifyRepositoryUrls(repositories: DiscoveredRepository[]): DiscoveredRepository[] {
  const usedUrls = new Set<string>()
  for (const repo of repositories) {
    if (usedUrls.has(repo.gitUrl)) {
      repo.gitUrl = pathToFileURL(repo.localPath).href
    }
    usedUrls.add(repo.gitUrl)
  }
  return repositories
}

async function discoverDirectoryProject(root: string): Promise<{
  kind: Exclude<ProjectKind, 'clone'>
  repositories: DiscoveredRepository[]
}> {
  const childPaths = listImmediateGitCheckouts(root)
  const children = await Promise.all(childPaths.map((path) => describeCheckout(path)))

  // Sibling git checkouts win even if the chosen folder is itself a git repo.
  if (children.length > 1) {
    return { kind: 'multi-root', repositories: uniquifyRepositoryUrls(children) }
  }

  const rootRepo = isUsableGitWorkTree(root) ? await tryDescribeGitRepository(root) : null
  if (rootRepo) {
    return {
      kind: 'directory',
      repositories: [rootRepo]
    }
  }

  if (children.length === 1) {
    return { kind: 'directory', repositories: children }
  }

  // Any other folder still becomes a project. Git is only used to detect multi-root.
  return {
    kind: 'directory',
    repositories: [describeLocalDirectory(root)]
  }
}

/** Sentinel branch for a multi-root parent folder. Not a git branch. */
const ROOT_WORKSPACE_BRANCH = '.'

function insertRootWorkspace(
  db: ReturnType<typeof getDb>,
  projectId: number,
  repositoryId: number,
  rootPath: string
): void {
  db.prepare(
    `
INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path)
VALUES (?, ?, 'root', ?, ?)
    `
  ).run(projectId, repositoryId, ROOT_WORKSPACE_BRANCH, rootPath)
}

function insertRepositoriesAndDefaultWorkspaces(
  db: ReturnType<typeof getDb>,
  projectId: number,
  kind: ProjectKind,
  repositories: DiscoveredRepository[],
  directoryRoot?: string
): number {
  const insertRepo = db.prepare(
    `
INSERT INTO repositories (project_id, git_url, name, local_path, default_branch)
VALUES (?, ?, ?, ?, ?)
    `
  )
  const insertWorkspace = db.prepare(
    `
INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path)
VALUES (?, ?, 'default', ?, ?)
    `
  )

  let firstWorkspaceId: number | null = null
  let firstRepositoryId: number | null = null
  for (const repo of repositories) {
    const repoInsert = insertRepo.run(projectId, repo.gitUrl, repo.name, repo.localPath, repo.defaultBranch)
    const repositoryId = toId(repoInsert.lastInsertRowid)
    if (firstRepositoryId == null) firstRepositoryId = repositoryId
    const workspaceInsert = insertWorkspace.run(projectId, repositoryId, repo.defaultBranch, repo.localPath)
    const workspaceId = toId(workspaceInsert.lastInsertRowid)
    if (firstWorkspaceId == null) firstWorkspaceId = workspaceId
  }

  if (kind === 'multi-root') {
    if (firstRepositoryId == null) throw new Error('Project was created without a workspace.')
    const rootPath = directoryRoot ?? dirname(repositories[0]?.localPath ?? '')
    if (!rootPath) throw new Error('Multi-root project is missing a parent directory.')
    insertRootWorkspace(db, projectId, firstRepositoryId, rootPath)
  }

  if (firstWorkspaceId == null) throw new Error('Project was created without a workspace.')
  return firstWorkspaceId
}

function replaceProjectRepositories(
  projectId: number,
  kind: ProjectKind,
  repositories: DiscoveredRepository[],
  directoryRoot?: string
): number {
  const db = getDb()
  db.prepare('DELETE FROM repositories WHERE project_id = ?').run(projectId)
  db.prepare(
    `UPDATE projects SET kind = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(kind, projectId)

  return insertRepositoriesAndDefaultWorkspaces(db, projectId, kind, repositories, directoryRoot)
}

async function upgradeDirectoryProjectsWithNestedRepos(): Promise<void> {
  const db = getDb()
  const rows = db
    .prepare(
      `
SELECT p.id AS project_id, r.local_path
FROM projects p
JOIN repositories r ON r.project_id = p.id
WHERE p.kind = 'directory'
GROUP BY p.id
HAVING COUNT(r.id) = 1
      `
    )
    .all() as Array<{ project_id: number; local_path: string }>

  for (const row of rows) {
    let childPaths: string[]
    try {
      childPaths = listImmediateGitCheckouts(row.local_path)
    } catch {
      continue
    }
    if (childPaths.length <= 1) continue

    const workspaceCount = db
      .prepare('SELECT COUNT(*) AS n FROM workspaces WHERE project_id = ?')
      .get(row.project_id) as { n: number }
    if (workspaceCount.n !== 1) continue

    const repositories = uniquifyRepositoryUrls(
      await Promise.all(childPaths.map((path) => describeCheckout(path)))
    )
    const previousActive = getActiveWorkspaceId(db)

    try {
      db.exec('BEGIN IMMEDIATE')
      replaceProjectRepositories(row.project_id, 'multi-root', repositories, row.local_path)
      const activeStillValid =
        previousActive != null &&
        db.prepare('SELECT id FROM workspaces WHERE id = ?').get(previousActive) != null
      if (!activeStillValid) clearActiveWorkspaceId(db)
      db.exec('COMMIT')
    } catch {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Ignore rollback failures when the transaction never started.
      }
    }
  }
}

function assertPathsAvailable(localPaths: string[]): void {
  const db = getDb()
  const lookup = db.prepare('SELECT id FROM repositories WHERE local_path = ?')
  for (const localPath of localPaths) {
    const existing = lookup.get(localPath) as { id: number } | undefined
    if (existing) {
      throw new Error(`"${basename(localPath)}" is already added as a project.`)
    }
  }
}

function insertProjectWithRepositories(
  name: string,
  kind: ProjectKind,
  repositories: DiscoveredRepository[],
  directoryRoot?: string
): number {
  if (repositories.length === 0) {
    throw new Error('A project needs at least one git repository.')
  }

  const db = getDb()
  const projectInsert = db.prepare('INSERT INTO projects (name, kind) VALUES (?, ?)').run(name, kind)
  const projectId = toId(projectInsert.lastInsertRowid)

  insertRepositoriesAndDefaultWorkspaces(db, projectId, kind, repositories, directoryRoot)

  return projectId
}

async function loadCreatedProject(projectId: number): Promise<Project> {
  const listed = await listProjects()
  const project = listed.projects.find((item) => item.id === projectId)
  if (!project) throw new Error('Project was created but could not be loaded.')
  return project
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
    | { value: string }
    | undefined
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

function clearActiveWorkspaceId(db = getDb()): void {
  db.prepare('DELETE FROM app_state WHERE key = ?').run(ACTIVE_WORKSPACE_KEY)
}

/** Drop the persisted selection so the next list/load starts with no focused workspace. */
export function clearActiveWorkspace(db = getDb()): void {
  clearActiveWorkspaceId(db)
}

/** If the stored active workspace is gone, pick another (prefer same project). Stay unset if nothing was focused. */
function ensureActiveWorkspaceValid(preferredProjectId: number | null, db = getDb()): void {
  const active = getActiveWorkspaceId(db)
  if (active == null) return

  const stillThere = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(active) as
    | { id: number }
    | undefined
  if (stillThere) return

  if (preferredProjectId != null) {
    const sibling = db
      .prepare(
        `
SELECT id FROM workspaces
WHERE project_id = ?
ORDER BY CASE kind WHEN 'default' THEN 0 ELSE 1 END ASC, created_at ASC, id ASC
LIMIT 1
        `
      )
      .get(preferredProjectId) as { id: number } | undefined
    if (sibling) {
      setActiveWorkspaceId(sibling.id, db)
      return
    }
  }

  const any = db
    .prepare(
      `
SELECT id FROM workspaces
ORDER BY CASE kind WHEN 'default' THEN 0 ELSE 1 END ASC, created_at ASC, id ASC
LIMIT 1
      `
    )
    .get() as { id: number } | undefined

  if (any) setActiveWorkspaceId(any.id, db)
  else clearActiveWorkspaceId(db)
}

export type RemoveOptions = {
  deleteFiles: boolean
}

function loadProjectsFromDb(): { projects: Project[]; activeWorkspaceId: number | null } {
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
  CASE kind WHEN 'root' THEN 0 WHEN 'default' THEN 1 ELSE 2 END ASC,
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
    const parsed = primary ? tryParseGitUrl(primary.gitUrl) : null
    const github =
      row.kind !== 'multi-root' && primary && isGitHubGitUrl(primary.gitUrl, getLoginHost())
        ? parsed?.github ?? null
        : null

    return {
      id: row.id,
      name: row.name,
      kind: row.kind === 'directory' || row.kind === 'multi-root' ? row.kind : 'clone',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      repositories,
      workspaces: workspacesByProject.get(row.id) ?? [],
      github
    } satisfies Project
  })

  const activeWorkspaceId = getActiveWorkspaceId(db)
  const allWorkspaceIds = new Set(projects.flatMap((project) => project.workspaces.map((w) => w.id)))
  const resolvedActive =
    activeWorkspaceId != null && allWorkspaceIds.has(activeWorkspaceId) ? activeWorkspaceId : null

  return { projects, activeWorkspaceId: resolvedActive }
}

export async function listProjects(): Promise<ProjectListResult> {
  await upgradeDirectoryProjectsWithNestedRepos()
  const { projects, activeWorkspaceId } = loadProjectsFromDb()
  return { projects, activeWorkspaceId }
}

export async function setActiveWorkspace(workspaceId: number): Promise<ProjectListResult> {
  const db = getDb()
  const row = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as
    | { id: number }
    | undefined
  if (!row) throw new Error('Workspace not found.')

  setActiveWorkspaceId(workspaceId, db)
  return listProjects()
}

/** Absolute checkout path for a workspace (default clone or worktree). */
export function getWorkspaceLocalPath(workspaceId: number): string {
  const db = getDb()
  const workspace = db
    .prepare('SELECT id, local_path FROM workspaces WHERE id = ?')
    .get(workspaceId) as { id: number; local_path: string } | undefined
  if (!workspace) throw new Error('Workspace not found.')
  return workspace.local_path
}

export async function getWorkspaceProjectId(workspaceId: number): Promise<number> {
  const db = getDb()
  const workspace = db
    .prepare('SELECT id, project_id FROM workspaces WHERE id = ?')
    .get(workspaceId) as { id: number; project_id: number } | undefined
  if (!workspace) throw new Error('Workspace not found.')
  return workspace.project_id
}

export async function createProjectFromGitUrl(
  gitUrl: string,
  options?: { githubToken?: string | null }
): Promise<Project> {
  const { url, name } = parseGitUrl(gitUrl)
  const localPath = allocateLocalPath(name)
  const token = options?.githubToken

  let defaultBranch: string
  try {
    defaultBranch = await cloneRepository(url, localPath, token)
  } catch (error) {
    if (existsSync(localPath)) rmSync(localPath, { recursive: true, force: true })
    throw error
  }

  const db = getDb()
  try {
    db.exec('BEGIN IMMEDIATE')
    const projectId = insertProjectWithRepositories(name, 'clone', [
      { gitUrl: url, name, localPath, defaultBranch }
    ])
    db.exec('COMMIT')
    return await loadCreatedProject(projectId)
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Ignore rollback failures when the transaction never started.
    }
    try {
      rmSync(localPath, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup.
    }
    throw error
  }
}

export async function createProjectFromDirectory(directory: string): Promise<Project> {
  try {
    const root = resolveExistingDirectory(directory)
    const discovered = await discoverDirectoryProject(root)
    assertPathsAvailable(discovered.repositories.map((repo) => repo.localPath))

    const db = getDb()
    try {
      db.exec('BEGIN IMMEDIATE')
      const projectId = insertProjectWithRepositories(
        basename(root),
        discovered.kind,
        discovered.repositories,
        discovered.kind === 'multi-root' ? root : undefined
      )
      db.exec('COMMIT')
      return await loadCreatedProject(projectId)
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Ignore rollback failures when the transaction never started.
      }
      throw error
    }
  } catch (error) {
    throw directoryImportError(error)
  }
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

  if (!repository) throw new Error('Project has no linked repository.')
  return repository
}

export async function listProjectBranches(
  projectId: number,
  options?: { githubToken?: string | null }
): Promise<ProjectBranch[]> {
  const db = getDb()
  const project = db.prepare('SELECT id, kind FROM projects WHERE id = ?').get(projectId) as
    | { id: number; kind: ProjectKind }
    | undefined
  if (!project) throw new Error('Project not found.')
  if (project.kind === 'multi-root') {
    throw new Error('Worktrees are not supported for multi-root workspaces.')
  }

  const repository = getPrimaryRepository(projectId)
  if (!isGitHubGitUrl(repository.git_url, getLoginHost())) {
    throw new Error('Worktrees can only be created for GitHub-linked projects.')
  }

  const existing = new Set(
    (
      db
        .prepare('SELECT branch FROM workspaces WHERE repository_id = ?')
        .all(repository.id) as Array<{ branch: string }>
    ).map((row) => row.branch)
  )

  const token = options?.githubToken
  const branches = await listRemoteBranches(repository.local_path, token)
  return branches.map((name) => ({
    name,
    hasWorkspace: existing.has(name)
  }))
}

export async function createWorkspaceFromBranch(
  projectId: number,
  branch: string,
  options?: { githubToken?: string | null }
): Promise<Workspace> {
  const trimmed = branch.trim()
  if (!trimmed) throw new Error('Branch name is required.')

  const db = getDb()
  const project = db.prepare('SELECT id, name, kind FROM projects WHERE id = ?').get(projectId) as
    | { id: number; name: string; kind: ProjectKind }
    | undefined
  if (!project) throw new Error('Project not found.')
  if (project.kind === 'multi-root') {
    throw new Error('Worktrees are not supported for multi-root workspaces.')
  }

  const repository = getPrimaryRepository(projectId)
  if (!isGitHubGitUrl(repository.git_url, getLoginHost())) {
    throw new Error('Worktrees can only be created for GitHub-linked projects.')
  }

  const existing = db
    .prepare('SELECT id FROM workspaces WHERE repository_id = ? AND branch = ?')
    .get(repository.id, trimmed) as { id: number } | undefined
  if (existing) {
    throw new Error(`A workspace for branch "${trimmed}" already exists.`)
  }

  const dest = allocateLocalPath(`${repository.name}-${sanitizeBranchForPath(trimmed)}`)
  const token = options?.githubToken

  try {
    await addWorktree(repository.local_path, dest, trimmed, token)
  } catch (error) {
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    throw error
  }

  try {
    db.exec('BEGIN IMMEDIATE')
    const insert = db
      .prepare(
        `
INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path)
VALUES (?, ?, 'worktree', ?, ?)
        `
      )
      .run(projectId, repository.id, trimmed, dest)
    const workspaceId = toId(insert.lastInsertRowid)
    setActiveWorkspaceId(workspaceId, db)
    db.exec('COMMIT')

    const listed = await listProjects()
    const workspace = listed.projects.flatMap((item) => item.workspaces).find((item) => item.id === workspaceId)
    if (!workspace) throw new Error('Workspace was created but could not be loaded.')
    return workspace
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Ignore rollback failures when the transaction never started.
    }
    try {
      rmSync(dest, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup.
    }
    throw error
  }
}

/**
 * Unregister a worktree workspace. Default workspaces cannot be removed —
 * remove the project instead.
 * When `deleteFiles` is true, also runs `git worktree remove --force`.
 */
export async function removeWorkspace(
  workspaceId: number,
  options: RemoveOptions
): Promise<ProjectListResult> {
  const db = getDb()
  const workspace = db
    .prepare(
      `
SELECT id, project_id, repository_id, kind, branch, local_path, created_at
FROM workspaces
WHERE id = ?
      `
    )
    .get(workspaceId) as WorkspaceRow | undefined

  if (!workspace) throw new Error('Workspace not found.')
  if (workspace.kind === 'default' || workspace.kind === 'root') {
    throw new Error(
      workspace.kind === 'root'
        ? "Root workspace can't be deleted. Remove the project instead."
        : "Default workspace can't be deleted. Remove the project instead."
    )
  }

  if (options.deleteFiles) {
    const repository = db
      .prepare('SELECT local_path FROM repositories WHERE id = ?')
      .get(workspace.repository_id) as { local_path: string } | undefined
    if (!repository) throw new Error('Repository not found.')
    await removeWorktree(repository.local_path, workspace.local_path)
  }

  db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
  ensureActiveWorkspaceValid(workspace.project_id, db)
  return listProjects()
}

/**
 * Unregister a project (CASCADE clears repositories and workspaces).
 * When `deleteFiles` is true, first removes every nested worktree from disk.
 * Default checkouts and opened folders are never deleted from disk.
 */
export async function removeProject(
  projectId: number,
  options: RemoveOptions
): Promise<ProjectListResult> {
  const db = getDb()
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as
    | { id: number }
    | undefined
  if (!project) throw new Error('Project not found.')

  const worktrees = db
    .prepare(
      `
SELECT w.id, w.local_path, r.local_path AS repository_path
FROM workspaces w
JOIN repositories r ON r.id = w.repository_id
WHERE w.project_id = ? AND w.kind = 'worktree'
      `
    )
    .all(projectId) as Array<{ id: number; local_path: string; repository_path: string }>

  if (options.deleteFiles) {
    for (const worktree of worktrees) {
      await removeWorktree(worktree.repository_path, worktree.local_path)
    }
  }

  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  ensureActiveWorkspaceValid(null, db)
  return listProjects()
}

