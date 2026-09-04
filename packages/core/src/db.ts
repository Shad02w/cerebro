import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getDatabasePath } from './paths'

let db: DatabaseSync | null = null

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'clone' CHECK (kind IN ('clone', 'directory', 'multi-root')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  git_url TEXT NOT NULL,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, git_url)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('default', 'worktree')),
  branch TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, branch)
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

function tableExists(database: DatabaseSync, name: string): boolean {
  const row = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { name: string } | undefined
  return Boolean(row)
}

function columnExists(database: DatabaseSync, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((row) => row.name === column)
}

function tableSql(database: DatabaseSync, name: string): string {
  const row = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { sql: string } | undefined
  return row?.sql ?? ''
}

function migrateProjectKind(database: DatabaseSync): void {
  if (!tableExists(database, 'projects') || columnExists(database, 'projects', 'kind')) return
  database.exec(`ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'clone'`)
}

function migrateWorkspaceBranchUniqueness(database: DatabaseSync): void {
  if (!tableExists(database, 'workspaces')) return
  const sql = tableSql(database, 'workspaces')
  if (!/UNIQUE\s*\(\s*project_id\s*,\s*branch\s*\)/i.test(sql)) return

  database.exec('PRAGMA foreign_keys = OFF')
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
CREATE TABLE workspaces_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('default', 'worktree')),
  branch TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, branch)
);
    `)
    database.exec(`
INSERT INTO workspaces_new (id, project_id, repository_id, kind, branch, local_path, created_at)
SELECT id, project_id, repository_id, kind, branch, local_path, created_at
FROM workspaces;
    `)
    database.exec('DROP TABLE workspaces')
    database.exec('ALTER TABLE workspaces_new RENAME TO workspaces')
    database.exec('COMMIT')
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Ignore rollback failures when the transaction never started.
    }
    throw error
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

function migrateLegacySchema(database: DatabaseSync): void {
  const hasLegacyWorkspaces = tableExists(database, 'workspaces') && !tableExists(database, 'projects')
  const hasLegacyRepoColumn =
    tableExists(database, 'repositories') && columnExists(database, 'repositories', 'workspace_id')

  if (!hasLegacyWorkspaces && !hasLegacyRepoColumn) return

  database.exec('PRAGMA foreign_keys = OFF')
  database.exec('BEGIN IMMEDIATE')

  try {
    if (hasLegacyWorkspaces) {
      database.exec('ALTER TABLE workspaces RENAME TO projects')
    }

    if (tableExists(database, 'repositories') && columnExists(database, 'repositories', 'workspace_id')) {
      database.exec(`
CREATE TABLE repositories_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  git_url TEXT NOT NULL,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, git_url)
);
      `)

      database.exec(`
INSERT INTO repositories_new (id, project_id, git_url, name, local_path, default_branch, created_at)
SELECT id, workspace_id, git_url, name, local_path, default_branch, created_at
FROM repositories;
      `)

      database.exec('DROP TABLE repositories')
      database.exec('ALTER TABLE repositories_new RENAME TO repositories')
    }

    if (!tableExists(database, 'workspaces')) {
      database.exec(`
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('default', 'worktree')),
  branch TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, branch)
);
      `)
    }

    const repoRows = database
      .prepare(
        `
SELECT id, project_id, local_path, default_branch
FROM repositories
ORDER BY id ASC
        `
      )
      .all() as Array<{
        id: number
        project_id: number
        local_path: string
        default_branch: string
      }>

    const insertWorkspace = database.prepare(
      `
INSERT OR IGNORE INTO workspaces (project_id, repository_id, kind, branch, local_path)
VALUES (?, ?, 'default', ?, ?)
      `
    )

    for (const repo of repoRows) {
      insertWorkspace.run(repo.project_id, repo.id, repo.default_branch, repo.local_path)
    }

    const active = database
      .prepare(`SELECT value FROM app_state WHERE key = 'active_workspace_id'`)
      .get() as { value: string } | undefined

    if (active) {
      const legacyId = Number(active.value)
      if (Number.isInteger(legacyId) && legacyId > 0) {
        const mapped = database
          .prepare(
            `
SELECT id
FROM workspaces
WHERE project_id = ? AND kind = 'default'
ORDER BY id ASC
LIMIT 1
            `
          )
          .get(legacyId) as { id: number } | undefined

        if (mapped) {
          database
            .prepare(
              `
INSERT INTO app_state (key, value)
VALUES ('active_workspace_id', ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value
              `
            )
            .run(String(mapped.id))
        }
      }
    }

    database.exec('COMMIT')
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Ignore rollback failures when the transaction never started.
    }
    throw error
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

export function getDb(): DatabaseSync {
  if (db) return db

  const databasePath = getDatabasePath()
  mkdirSync(dirname(databasePath), { recursive: true })

  db = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true
  })

  // Give concurrent writers (e.g. CLI + desktop app) up to 5 s before throwing SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000')

  // Apply legacy migration before CREATE IF NOT EXISTS so we can detect the old shape.
  if (tableExists(db, 'workspaces') && !tableExists(db, 'projects')) {
    migrateLegacySchema(db)
  } else if (tableExists(db, 'repositories') && columnExists(db, 'repositories', 'workspace_id')) {
    migrateLegacySchema(db)
  }

  db.exec(SCHEMA)
  migrateProjectKind(db)
  migrateWorkspaceBranchUniqueness(db)

  // Fresh DBs never hit the rename path; ensure workspaces exist for any pre-migration repos.
  if (tableExists(db, 'repositories') && tableExists(db, 'workspaces')) {
    const missingDefaults = db
      .prepare(
        `
SELECT r.id, r.project_id, r.local_path, r.default_branch
FROM repositories r
LEFT JOIN workspaces w
  ON w.repository_id = r.id AND w.kind = 'default'
WHERE w.id IS NULL
        `
      )
      .all() as Array<{
        id: number
        project_id: number
        local_path: string
        default_branch: string
      }>

    const insert = db.prepare(
      `
INSERT OR IGNORE INTO workspaces (project_id, repository_id, kind, branch, local_path)
VALUES (?, ?, 'default', ?, ?)
      `
    )
    for (const repo of missingDefaults) {
      insert.run(repo.project_id, repo.id, repo.default_branch, repo.local_path)
    }
  }

  return db
}

export function closeDb(): void {
  if (!db) return
  db.close()
  db = null
}

export function resetDbConnection(): void {
  closeDb()
}

export function databaseFileExists(): boolean {
  return existsSync(getDatabasePath())
}

export function toId(value: number | bigint): number {
  return Number(value)
}

