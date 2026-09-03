import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { LinkedRepository, Workspace, WorkspaceListResult } from '../shared/types'
import { getDb, toId } from './db'
import { cloneRepository, parseGitUrl } from './git'
import { ensureCerebroHome, isReservedName } from './paths'

const ACTIVE_WORKSPACE_KEY = 'active_workspace_id'

type WorkspaceRow = {
  id: number
  name: string
  created_at: string
  updated_at: string
}

type RepositoryRow = {
  id: number
  workspace_id: number
  git_url: string
  name: string
  local_path: string
  default_branch: string
  created_at: string
}

function mapRepository(row: RepositoryRow): LinkedRepository {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    gitUrl: row.git_url,
    name: row.name,
    localPath: row.local_path,
    defaultBranch: row.default_branch,
    createdAt: row.created_at
  }
}

function mapWorkspace(row: WorkspaceRow, repositories: LinkedRepository[]): Workspace {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    repositories
  }
}

function allocateLocalPath(baseName: string): string {
  const home = ensureCerebroHome()
  const slug = isReservedName(baseName) ? `${baseName}-repo` : baseName
  let candidate = join(home, slug)
  let suffix = 2

  while (existsSync(candidate)) {
    candidate = join(home, `${slug}-${suffix}`)
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

export function listWorkspaces(): WorkspaceListResult {
  const db = getDb()
  const workspaceRows = db
    .prepare(
      'SELECT id, name, created_at, updated_at FROM workspaces ORDER BY created_at DESC, id DESC'
    )
    .all() as WorkspaceRow[]
  const repositoryRows = db
    .prepare(
      `
        SELECT id, workspace_id, git_url, name, local_path, default_branch, created_at
        FROM repositories
        ORDER BY created_at ASC, id ASC
      `
    )
    .all() as RepositoryRow[]

  const reposByWorkspace = new Map<number, LinkedRepository[]>()
  for (const row of repositoryRows) {
    const list = reposByWorkspace.get(row.workspace_id) ?? []
    list.push(mapRepository(row))
    reposByWorkspace.set(row.workspace_id, list)
  }

  const workspaces = workspaceRows.map((row) =>
    mapWorkspace(row, reposByWorkspace.get(row.id) ?? [])
  )
  const activeWorkspaceId = getActiveWorkspaceId(db)
  const activeStillExists = workspaces.some((workspace) => workspace.id === activeWorkspaceId)

  return {
    workspaces,
    activeWorkspaceId: activeStillExists ? activeWorkspaceId : (workspaces[0]?.id ?? null)
  }
}

export function setActiveWorkspace(workspaceId: number): WorkspaceListResult {
  const db = getDb()
  const row = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as
    { id: number } | undefined
  if (!row) {
    throw new Error('Workspace not found.')
  }

  setActiveWorkspaceId(workspaceId, db)
  return listWorkspaces()
}

export async function createWorkspaceFromGitUrl(gitUrl: string): Promise<Workspace> {
  const { url, name } = parseGitUrl(gitUrl)
  const localPath = allocateLocalPath(name)

  let defaultBranch: string
  try {
    defaultBranch = await cloneRepository(url, localPath)
  } catch (error) {
    if (existsSync(localPath)) {
      rmSync(localPath, { recursive: true, force: true })
    }
    throw error
  }

  const db = getDb()

  try {
    db.exec('BEGIN IMMEDIATE')

    const workspaceInsert = db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(name)
    const workspaceId = toId(workspaceInsert.lastInsertRowid)

    db.prepare(
      `
        INSERT INTO repositories (workspace_id, git_url, name, local_path, default_branch)
        VALUES (?, ?, ?, ?, ?)
      `
    ).run(workspaceId, url, name, localPath, defaultBranch)

    setActiveWorkspaceId(workspaceId, db)
    db.exec('COMMIT')

    const workspace = listWorkspaces().workspaces.find((item) => item.id === workspaceId)
    if (!workspace) {
      throw new Error('Workspace was created but could not be loaded.')
    }
    return workspace
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Ignore rollback failures when the transaction never started.
    }
    rmSync(localPath, { recursive: true, force: true })
    throw error
  }
}
