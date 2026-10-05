import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { closeDb, getDb, resetDbConnection } from './src/db'
import { setWorkspaceStatus } from './src/projects'
import { parseWorkspaceStatus } from './src/types'

const LEGACY_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'clone',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  git_url TEXT NOT NULL,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, git_url)
);
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('default', 'worktree', 'root')),
  branch TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, branch)
);
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

test('workspace rows start as todo and accept the four workflow statuses', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cerebro-workspace-status-'))
  const previousHome = process.env.CEREBRO_HOME
  const previousDb = process.env.CEREBRO_DB_PATH
  t.after(async () => {
    resetDbConnection()
    if (previousHome === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previousHome
    if (previousDb === undefined) delete process.env.CEREBRO_DB_PATH
    else process.env.CEREBRO_DB_PATH = previousDb
    await rm(dir, { recursive: true, force: true })
  })

  assert.equal(parseWorkspaceStatus('in-progress'), 'in_progress')
  assert.equal(parseWorkspaceStatus('Ready to review'), 'ready_to_review')
  assert.equal(parseWorkspaceStatus('DONE'), 'done')
  assert.equal(parseWorkspaceStatus('later'), null)

  process.env.CEREBRO_HOME = dir
  process.env.CEREBRO_DB_PATH = join(dir, 'fresh.sqlite')
  resetDbConnection()
  const fresh = getDb()
  const project = fresh.prepare(`INSERT INTO projects (name, kind) VALUES ('demo', 'clone')`).run()
  const projectId = Number(project.lastInsertRowid)
  const repository = fresh
    .prepare(
      `INSERT INTO repositories (project_id, git_url, name, local_path, default_branch)
       VALUES (?, 'https://github.com/acme/demo.git', 'demo', ?, 'main')`
    )
    .run(projectId, join(dir, 'demo'))
  const repositoryId = Number(repository.lastInsertRowid)
  const workspace = fresh
    .prepare(
      `INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path)
       VALUES (?, ?, 'default', 'main', ?)`
    )
    .run(projectId, repositoryId, join(dir, 'demo'))
  const workspaceId = Number(workspace.lastInsertRowid)
  assert.equal(
    (
      fresh.prepare('SELECT status FROM workspaces WHERE id = ?').get(workspaceId) as {
        status: string
      }
    ).status,
    'todo'
  )

  const updated = await setWorkspaceStatus(workspaceId, 'in_progress')
  assert.equal(updated.status, 'in_progress')
  assert.equal(updated.id, workspaceId)
  await assert.rejects(
    () => setWorkspaceStatus(workspaceId, 'later' as 'todo'),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as { code?: string }).code, 'usage')
      return true
    }
  )
  await assert.rejects(
    () => setWorkspaceStatus(999, 'done'),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as { code?: string }).code, 'not_found')
      return true
    }
  )

  closeDb()
  const legacyPath = join(dir, 'legacy.sqlite')
  const legacy = new DatabaseSync(legacyPath)
  legacy.exec(LEGACY_SCHEMA)
  const legacyProject = legacy
    .prepare(`INSERT INTO projects (name, kind) VALUES ('legacy', 'clone')`)
    .run()
  const legacyProjectId = Number(legacyProject.lastInsertRowid)
  const legacyRepository = legacy
    .prepare(
      `INSERT INTO repositories (project_id, git_url, name, local_path, default_branch)
       VALUES (?, 'https://github.com/acme/legacy.git', 'legacy', ?, 'main')`
    )
    .run(legacyProjectId, join(dir, 'legacy'))
  legacy
    .prepare(
      `INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path)
       VALUES (?, ?, 'default', 'main', ?)`
    )
    .run(legacyProjectId, Number(legacyRepository.lastInsertRowid), join(dir, 'legacy'))
  legacy.close()

  process.env.CEREBRO_DB_PATH = legacyPath
  resetDbConnection()
  const migrated = getDb()
  const migratedStatus = migrated.prepare('SELECT status FROM workspaces').get() as {
    status: string
  }
  assert.equal(migratedStatus.status, 'todo')
  const migratedWorkspace = await setWorkspaceStatus(1, 'done')
  assert.equal(migratedWorkspace.status, 'done')
})
