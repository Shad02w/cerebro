import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { resetDbConnection } from './db'
import { createProjectFromDirectory, listProjects, renameWorkspace } from './projects'
import { WORKSPACE_NAME_MAX_LENGTH } from './types'

const OLD_SCHEMA = `
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'clone' CHECK (kind IN ('clone', 'directory', 'multi-root')),
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

async function withHome(prefix: string, run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), prefix))
  const previousHome = process.env.CEREBRO_HOME
  const previousDb = process.env.CEREBRO_DB_PATH
  process.env.CEREBRO_HOME = home
  process.env.CEREBRO_DB_PATH = join(home, 'cerebro.sqlite')
  resetDbConnection()
  try {
    await run(home)
  } finally {
    resetDbConnection()
    if (previousHome == null) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previousHome
    if (previousDb == null) delete process.env.CEREBRO_DB_PATH
    else process.env.CEREBRO_DB_PATH = previousDb
    await rm(home, { recursive: true, force: true })
  }
}

test('workspace display names persist, reset, and migrate onto older databases', async () => {
  await withHome('cerebro-workspace-name-', async (home) => {
    const database = new DatabaseSync(join(home, 'cerebro.sqlite'))
    database.exec(OLD_SCHEMA)
    database.close()

    const folder = join(home, 'notes')
    await mkdir(folder)
    const project = await createProjectFromDirectory(folder)
    const workspace = project.workspaces[0]
    assert.equal(workspace.displayName, null)

    const renamed = await renameWorkspace(workspace.id, '  Notes folder  ')
    const named = renamed.projects
      .flatMap((item) => item.workspaces)
      .find((item) => item.id === workspace.id)
    assert.equal(named?.displayName, 'Notes folder')

    const listed = await listProjects()
    assert.equal(
      listed.projects.flatMap((item) => item.workspaces).find((item) => item.id === workspace.id)
        ?.displayName,
      'Notes folder'
    )

    const reset = await renameWorkspace(workspace.id, null)
    assert.equal(
      reset.projects.flatMap((item) => item.workspaces).find((item) => item.id === workspace.id)
        ?.displayName,
      null
    )

    await assert.rejects(() => renameWorkspace(workspace.id, '   '), /Enter a name/)
    await assert.rejects(() => renameWorkspace(workspace.id, 'hello\nthere'), /line breaks/)
    await assert.rejects(
      () => renameWorkspace(workspace.id, 'a'.repeat(WORKSPACE_NAME_MAX_LENGTH + 1)),
      /characters or fewer/
    )
    await assert.rejects(() => renameWorkspace(999999, 'Missing'), /not found/)

    const max = await renameWorkspace(workspace.id, 'b'.repeat(WORKSPACE_NAME_MAX_LENGTH))
    assert.equal(
      max.projects.find((item) => item.id === project.id)?.workspaces[0]?.displayName?.length,
      WORKSPACE_NAME_MAX_LENGTH
    )
  })
})
