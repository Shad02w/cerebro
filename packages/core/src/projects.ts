import type { GitRemoteRunner } from './git'
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  type Dirent
} from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isWorkspaceStatus,
  WORKSPACE_NAME_MAX_LENGTH,
  type LinkedRepository,
  type NestedRepo,
  type Project,
  type ProjectBranch,
  type ProjectKind,
  type ProjectListResult,
  type Workspace,
  type WorkspaceKind,
  type WorkspaceStatus
} from './types'
import { getDb, toId } from './db'
import {
  addWorktree,
  cloneRepository,
  isGitHubGitUrl,
  listRemoteBranches,
  parseGitUrl,
  readDefaultBranch,
  readGitCommonDir,
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
  status: string
  display_name: string | null
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
  const displayName = row.display_name?.trim()
  return {
    id: row.id,
    projectId: row.project_id,
    repositoryId: row.repository_id,
    kind: row.kind,
    branch: row.branch,
    localPath: row.local_path,
    status: isWorkspaceStatus(row.status) ? row.status : 'todo',
    displayName: displayName ? displayName : null,
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

/** Current branch of each immediate child git checkout. The parent stays one workspace. */
async function listNestedRepos(directory: string): Promise<NestedRepo[]> {
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const nested: NestedRepo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const localPath = join(directory, entry.name)
    if (!isUsableGitWorkTree(localPath)) continue
    let branch = ''
    try {
      branch = await readDefaultBranch(localPath)
    } catch {
      branch = ''
    }
    nested.push({ name: entry.name, branch, localPath })
  }
  return nested.sort((left, right) => left.name.localeCompare(right.name))
}

function isPlainDirectory(project: Project): boolean {
  if (project.kind !== 'directory' || project.github) return false
  if (project.repositories.length !== 1 || project.workspaces.length !== 1) return false
  const repository = project.repositories[0]
  const workspace = project.workspaces[0]
  if (!repository || !workspace || workspace.kind === 'root') return false
  return repository.defaultBranch.trim() === '' && workspace.branch.trim() === ''
}

async function withNestedRepos(project: Project): Promise<Project> {
  if (!isPlainDirectory(project)) return { ...project, nestedRepos: [] }
  const directory = project.workspaces[0]?.localPath
  if (!directory) return { ...project, nestedRepos: [] }
  return { ...project, nestedRepos: await listNestedRepos(directory) }
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

async function gitCommonDir(localPath: string): Promise<string | null> {
  try {
    return realpathSync(await readGitCommonDir(localPath))
  } catch {
    return null
  }
}

/** Project that already tracks this checkout's git repository, if one exists. */
async function findProjectForGitCheckout(localPath: string): Promise<number | null> {
  const common = await gitCommonDir(localPath)
  if (!common) return null
  const db = getDb()
  const rows = db
    .prepare(
      `
SELECT r.project_id AS projectId, r.local_path AS localPath
FROM repositories r
JOIN projects p ON p.id = r.project_id
WHERE p.kind IN ('clone', 'directory')
      `
    )
    .all() as Array<{ projectId: number; localPath: string }>

  for (const row of rows) {
    if (row.localPath === localPath) continue
    if (!isUsableGitWorkTree(row.localPath)) continue
    if ((await gitCommonDir(row.localPath)) === common) return row.projectId
  }
  return null
}

/** The main checkout has a `.git` directory; a linked worktree has a `.git` file. */
function isPrimaryCheckoutPath(localPath: string): boolean {
  const gitPath = join(localPath, '.git')
  try {
    return existsSync(gitPath) && statSync(gitPath).isDirectory()
  } catch {
    return false
  }
}

function attachGitCheckout(
  db: ReturnType<typeof getDb>,
  projectId: number,
  localPath: string,
  described: DiscoveredRepository
): void {
  const taken = db.prepare('SELECT id FROM workspaces WHERE local_path = ?').get(localPath) as
    { id: number } | undefined
  if (taken) throw new Error(`"${basename(localPath)}" is already added.`)

  const repository = db
    .prepare(
      `
SELECT id
FROM repositories
WHERE project_id = ?
ORDER BY created_at ASC, id ASC
LIMIT 1
      `
    )
    .get(projectId) as { id: number } | undefined
  if (!repository) throw new Error('Project has no linked repository.')

  const branch = described.defaultBranch
  const existingBranch = db
    .prepare('SELECT id FROM workspaces WHERE repository_id = ? AND branch = ?')
    .get(repository.id, branch) as { id: number } | undefined
  if (existingBranch) {
    throw new Error(`A workspace for branch "${branch}" already exists.`)
  }

  let kind: 'default' | 'worktree' = isPrimaryCheckoutPath(localPath) ? 'default' : 'worktree'
  if (kind === 'default') {
    const current = db
      .prepare(
        `
SELECT id, local_path
FROM workspaces
WHERE repository_id = ? AND kind = 'default'
LIMIT 1
        `
      )
      .get(repository.id) as { id: number; local_path: string } | undefined
    if (current && !isPrimaryCheckoutPath(current.local_path)) {
      db.prepare(`UPDATE workspaces SET kind = 'worktree' WHERE id = ?`).run(current.id)
    } else if (current) {
      kind = 'worktree'
    }
  }

  db.prepare(
    `
INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path)
VALUES (?, ?, ?, ?, ?)
    `
  ).run(projectId, repository.id, kind, branch, localPath)
}

function insertRepositoriesAndDefaultWorkspaces(
  db: ReturnType<typeof getDb>,
  projectId: number,
  repositories: DiscoveredRepository[]
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
  for (const repo of repositories) {
    const repoInsert = insertRepo.run(
      projectId,
      repo.gitUrl,
      repo.name,
      repo.localPath,
      repo.defaultBranch
    )
    const repositoryId = toId(repoInsert.lastInsertRowid)
    const workspaceInsert = insertWorkspace.run(
      projectId,
      repositoryId,
      repo.defaultBranch,
      repo.localPath
    )
    if (firstWorkspaceId == null) firstWorkspaceId = toId(workspaceInsert.lastInsertRowid)
  }

  if (firstWorkspaceId == null) throw new Error('Project was created without a workspace.')
  return firstWorkspaceId
}

/**
 * Older builds grouped sibling git repos under one multi-root project.
 * Split each repo into its own project, and keep the parent folder as its own workspace.
 */
async function splitLegacyMultiRootProjects(): Promise<void> {
  const db = getDb()
  const projects = db.prepare(`SELECT id FROM projects WHERE kind = 'multi-root'`).all() as Array<{
    id: number
  }>
  if (projects.length === 0) return

  const reposFor = db.prepare(
    `
SELECT id, name
FROM repositories
WHERE project_id = ?
ORDER BY id ASC
    `
  )
  const rootFor = db.prepare(
    `
SELECT id, local_path
FROM workspaces
WHERE project_id = ? AND kind = 'root'
LIMIT 1
    `
  )
  const insertProject = db.prepare(`INSERT INTO projects (name, kind) VALUES (?, 'directory')`)
  const moveRepo = db.prepare(`UPDATE repositories SET project_id = ? WHERE id = ?`)
  const moveWorkspaces = db.prepare(
    `
UPDATE workspaces
SET project_id = ?
WHERE project_id = ? AND repository_id = ? AND kind != 'root'
    `
  )
  const insertRepo = db.prepare(
    `
INSERT INTO repositories (project_id, git_url, name, local_path, default_branch)
VALUES (?, ?, ?, ?, ?)
    `
  )
  const retargetRoot = db.prepare(
    `
UPDATE workspaces
SET project_id = ?, repository_id = ?, kind = 'default', branch = ?
WHERE id = ?
    `
  )

  for (const project of projects) {
    const repositories = reposFor.all(project.id) as Array<{ id: number; name: string }>
    const root = rootFor.get(project.id) as { id: number; local_path: string } | undefined
    const described =
      root && isUsableGitWorkTree(root.local_path)
        ? await tryDescribeGitRepository(root.local_path)
        : null

    try {
      db.exec('BEGIN IMMEDIATE')
      const current = db.prepare(`SELECT kind FROM projects WHERE id = ?`).get(project.id) as
        { kind: string } | undefined
      if (current?.kind !== 'multi-root') {
        db.exec('COMMIT')
        continue
      }
      for (const repo of repositories) {
        const created = insertProject.run(repo.name)
        const projectId = toId(created.lastInsertRowid)
        moveRepo.run(projectId, repo.id)
        moveWorkspaces.run(projectId, project.id, repo.id)
      }
      if (root) {
        const folder = described ?? describeLocalDirectory(root.local_path)
        const created = insertProject.run(folder.name)
        const projectId = toId(created.lastInsertRowid)
        const repository = insertRepo.run(
          projectId,
          folder.gitUrl,
          folder.name,
          folder.localPath,
          folder.defaultBranch
        )
        retargetRoot.run(projectId, toId(repository.lastInsertRowid), folder.defaultBranch, root.id)
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(project.id)
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
  const repositoryLookup = db.prepare('SELECT id FROM repositories WHERE local_path = ?')
  const workspaceLookup = db.prepare('SELECT id FROM workspaces WHERE local_path = ?')
  for (const localPath of localPaths) {
    const existing = (repositoryLookup.get(localPath) ?? workspaceLookup.get(localPath)) as
      { id: number } | undefined
    if (existing) {
      throw new Error(`"${basename(localPath)}" is already added.`)
    }
  }
}

function insertProjectWithRepositories(
  name: string,
  kind: ProjectKind,
  repositories: DiscoveredRepository[]
): number {
  if (repositories.length === 0) {
    throw new Error('A project needs at least one folder.')
  }

  const db = getDb()
  const projectInsert = db
    .prepare('INSERT INTO projects (name, kind) VALUES (?, ?)')
    .run(name, kind)
  const projectId = toId(projectInsert.lastInsertRowid)

  insertRepositoriesAndDefaultWorkspaces(db, projectId, repositories)

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
    { id: number } | undefined
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
SELECT id, project_id, repository_id, kind, branch, local_path, status, display_name, created_at
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
        ? (parsed?.github ?? null)
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
  const allWorkspaceIds = new Set(
    projects.flatMap((project) => project.workspaces.map((w) => w.id))
  )
  const resolvedActive =
    activeWorkspaceId != null && allWorkspaceIds.has(activeWorkspaceId) ? activeWorkspaceId : null

  return { projects, activeWorkspaceId: resolvedActive }
}

export async function listProjects(): Promise<ProjectListResult> {
  await splitLegacyMultiRootProjects()
  const loaded = loadProjectsFromDb()
  const projects = await Promise.all(loaded.projects.map((project) => withNestedRepos(project)))
  return { projects, activeWorkspaceId: loaded.activeWorkspaceId }
}

export async function setActiveWorkspace(workspaceId: number): Promise<ProjectListResult> {
  const db = getDb()
  const row = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as
    { id: number } | undefined
  if (!row) throw new Error('Workspace not found.')

  setActiveWorkspaceId(workspaceId, db)
  return listProjects()
}

export async function setWorkspaceStatus(
  workspaceId: number,
  status: WorkspaceStatus
): Promise<Workspace> {
  if (!isWorkspaceStatus(status)) {
    throw Object.assign(new Error(`Unknown workspace status "${String(status)}".`), {
      code: 'usage'
    })
  }

  const db = getDb()
  const row = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as
    { id: number } | undefined
  if (!row) throw Object.assign(new Error('Workspace not found.'), { code: 'not_found' })

  db.prepare('UPDATE workspaces SET status = ? WHERE id = ?').run(status, workspaceId)
  const listed = await listProjects()
  const workspace = listed.projects
    .flatMap((project) => project.workspaces)
    .find((item) => item.id === workspaceId)
  if (!workspace) throw Object.assign(new Error('Workspace not found.'), { code: 'not_found' })
  return workspace
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
  options?: { git?: GitRemoteRunner }
): Promise<Project> {
  const { url, name } = parseGitUrl(gitUrl)
  const localPath = allocateLocalPath(name)

  let defaultBranch: string
  try {
    defaultBranch = await cloneRepository(url, localPath, options?.git)
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
    const db = getDb()

    if (isUsableGitWorkTree(root)) {
      const described = await describeGitRepository(root)
      const existingId = await findProjectForGitCheckout(root)
      try {
        db.exec('BEGIN IMMEDIATE')
        if (existingId != null) {
          attachGitCheckout(db, existingId, root, described)
          db.exec('COMMIT')
          return await loadCreatedProject(existingId)
        }
        assertPathsAvailable([root])
        const projectId = insertProjectWithRepositories(basename(root), 'directory', [described])
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
    }

    assertPathsAvailable([root])
    try {
      db.exec('BEGIN IMMEDIATE')
      const projectId = insertProjectWithRepositories(basename(root), 'directory', [
        describeLocalDirectory(root)
      ])
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

export async function listProjectBranches(projectId: number): Promise<ProjectBranch[]> {
  const db = getDb()
  const project = db.prepare('SELECT id, kind FROM projects WHERE id = ?').get(projectId) as
    { id: number; kind: ProjectKind } | undefined
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

  const branches = await listRemoteBranches(repository.local_path)
  return branches.map((name) => ({
    name,
    hasWorkspace: existing.has(name)
  }))
}

export async function createWorkspaceFromBranch(
  projectId: number,
  branch: string,
  options?: {
    from?: string | null
    /**
     * Select the new workspace. Omitted means yes, so desktop creation still focuses it.
     * The CLI passes false unless the user set --focus.
     */
    focus?: boolean
    git?: GitRemoteRunner
    /** Mux operation journal hooks; invoked before Git and within the metadata transaction. */
    onPrepared?: (path: string) => void
    onCommitted?: (workspaceId: number) => void
  }
): Promise<Workspace> {
  const trimmed = branch.trim()
  if (!trimmed) throw new Error('Branch name is required.')

  const from = options?.from?.trim() || null
  if (options?.from != null && options.from.trim() === '') {
    throw new Error('Base branch is required when creating a new branch.')
  }

  const db = getDb()
  const project = db.prepare('SELECT id, name, kind FROM projects WHERE id = ?').get(projectId) as
    { id: number; name: string; kind: ProjectKind } | undefined
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

  options?.onPrepared?.(dest)
  try {
    await addWorktree(repository.local_path, dest, trimmed, from, options?.git)
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
    if (options?.focus !== false) setActiveWorkspaceId(workspaceId, db)
    options?.onCommitted?.(workspaceId)
    db.exec('COMMIT')

    const listed = await listProjects()
    const workspace = listed.projects
      .flatMap((item) => item.workspaces)
      .find((item) => item.id === workspaceId)
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
SELECT id, project_id, repository_id, kind, branch, local_path, status, display_name, created_at
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

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 31) return true
  }
  return false
}

/**
 * Set the sidebar label for a workspace. `null` clears it so the row uses the
 * default directory name or branch name again.
 */
export async function renameWorkspace(
  workspaceId: number,
  displayName: string | null
): Promise<ProjectListResult> {
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error('Workspace not found.')
  }
  if (displayName != null && typeof displayName !== 'string') {
    throw Object.assign(new Error('Enter a name.'), { code: 'usage' })
  }

  let stored: string | null = null
  if (displayName != null) {
    const trimmed = displayName.trim()
    if (!trimmed) throw Object.assign(new Error('Enter a name.'), { code: 'usage' })
    if (containsControlCharacter(trimmed)) {
      throw Object.assign(new Error('Name cannot include line breaks.'), { code: 'usage' })
    }
    if ([...trimmed].length > WORKSPACE_NAME_MAX_LENGTH) {
      throw Object.assign(
        new Error(`Name must be ${WORKSPACE_NAME_MAX_LENGTH} characters or fewer.`),
        { code: 'usage' }
      )
    }
    stored = trimmed
  }

  const db = getDb()
  const existing = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as
    { id: number } | undefined
  if (!existing) throw new Error('Workspace not found.')

  db.prepare('UPDATE workspaces SET display_name = ? WHERE id = ?').run(stored, workspaceId)
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
    { id: number } | undefined
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
