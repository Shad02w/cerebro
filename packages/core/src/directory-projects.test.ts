import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { getDb, resetDbConnection } from './db'
import { createProjectFromDirectory, listProjects } from './projects'

const execFileAsync = promisify(execFile)

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

async function initGitRepo(dir: string, branch: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await execFileAsync('git', ['init', '-b', branch], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 't@cerebro.local'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), `${branch}\n`)
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir })
}

test('a folder of git repos becomes one project per repo', async () => {
  await withHome('cerebro-dir-projects-', async (home) => {
    const parent = join(home, 'apps-folder')
    const frontend = join(parent, 'frontend')
    const backend = join(parent, 'backend')
    const notes = join(parent, 'notes')
    await initGitRepo(frontend, 'main')
    await initGitRepo(backend, 'develop')
    await mkdir(notes, { recursive: true })
    await writeFile(join(notes, 'notes.txt'), 'hello\n')

    const first = await createProjectFromDirectory(parent)
    const listed = await listProjects()
    const names = listed.projects.map((project) => project.name).sort()
    assert.deepEqual(names, ['backend', 'frontend'])
    assert.equal(
      listed.projects.some((project) => project.kind === 'multi-root'),
      false
    )
    assert.equal(
      listed.projects.some((project) => project.name === 'apps-folder'),
      false
    )
    for (const project of listed.projects) {
      assert.equal(project.kind, 'directory')
      assert.equal(project.repositories.length, 1)
      assert.equal(project.workspaces.length, 1)
      assert.equal(project.workspaces[0]?.kind, 'default')
      assert.equal(project.name, project.repositories[0]?.name)
    }
    const backendProject = listed.projects.find((project) => project.name === 'backend')
    assert.equal(backendProject?.workspaces[0]?.branch, 'develop')
    assert.equal(first.name, 'backend')
  })
})

test('a git folder with sibling git repos does not keep the parent as a project group', async () => {
  await withHome('cerebro-dir-parent-', async (home) => {
    const parent = join(home, 'abc')
    await initGitRepo(parent, 'main')
    await initGitRepo(join(parent, 'ark-ui'), 'main')
    await initGitRepo(join(parent, 'other-app'), 'main')

    await createProjectFromDirectory(parent)
    const listed = await listProjects()
    assert.deepEqual(listed.projects.map((project) => project.name).sort(), ['ark-ui', 'other-app'])
    assert.equal(
      listed.projects.some((project) =>
        project.workspaces.some((workspace) => workspace.kind === 'root')
      ),
      false
    )
  })
})

test('one nested git repo is named after that repo', async () => {
  await withHome('cerebro-dir-nested-', async (home) => {
    const parent = join(home, 'wrapper')
    const repo = join(parent, 'opened-alpha')
    await initGitRepo(repo, 'main')

    const project = await createProjectFromDirectory(parent)
    assert.equal(project.name, 'opened-alpha')
    assert.equal(project.kind, 'directory')
    assert.equal(project.repositories[0]?.localPath, await realpath(repo))
  })
})

test('a folder that is not a git repo is still opened', async () => {
  await withHome('cerebro-dir-plain-', async (home) => {
    const folder = join(home, 'plain-folder')
    await mkdir(folder, { recursive: true })
    const project = await createProjectFromDirectory(folder)
    assert.equal(project.name, 'plain-folder')
    assert.equal(project.kind, 'directory')
    assert.equal(project.workspaces.length, 1)
  })
})

test('stored multi-root projects split into per-repo projects and drop non-git workspaces', async () => {
  await withHome('cerebro-dir-split-', async (home) => {
    const parent = join(home, 'apps-folder')
    const frontend = join(parent, 'frontend')
    const notes = join(parent, 'notes')
    await initGitRepo(frontend, 'main')
    await mkdir(notes, { recursive: true })

    const db = getDb()
    const project = db
      .prepare(`INSERT INTO projects (name, kind) VALUES ('apps-folder', 'multi-root')`)
      .run()
    const projectId = Number(project.lastInsertRowid)
    const frontendRepo = db
      .prepare(
        `INSERT INTO repositories (project_id, git_url, name, local_path, default_branch) VALUES (?, 'file://frontend', 'frontend', ?, 'main')`
      )
      .run(projectId, frontend)
    const frontendRepoId = Number(frontendRepo.lastInsertRowid)
    const notesRepo = db
      .prepare(
        `INSERT INTO repositories (project_id, git_url, name, local_path, default_branch) VALUES (?, 'file://notes', 'notes', ?, '')`
      )
      .run(projectId, notes)
    const notesRepoId = Number(notesRepo.lastInsertRowid)
    const frontendWorkspace = db
      .prepare(
        `INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path, status) VALUES (?, ?, 'default', 'main', ?, 'in_progress')`
      )
      .run(projectId, frontendRepoId, frontend)
    const frontendWorkspaceId = Number(frontendWorkspace.lastInsertRowid)
    db.prepare(
      `INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path) VALUES (?, ?, 'default', '', ?)`
    ).run(projectId, notesRepoId, notes)
    const root = db
      .prepare(
        `INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path) VALUES (?, ?, 'root', '.', ?)`
      )
      .run(projectId, frontendRepoId, parent)
    db.prepare(
      `INSERT INTO app_state (key, value) VALUES ('active_workspace_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(root.lastInsertRowid))

    const listed = await listProjects()
    assert.equal(listed.projects.length, 1)
    const kept = listed.projects[0]
    assert.equal(kept?.name, 'frontend')
    assert.equal(kept?.kind, 'directory')
    assert.equal(kept?.workspaces.length, 1)
    assert.equal(kept?.workspaces[0]?.id, frontendWorkspaceId)
    assert.equal(kept?.workspaces[0]?.status, 'in_progress')
    assert.equal(
      kept?.workspaces.some((workspace) => workspace.kind === 'root'),
      false
    )
    assert.equal(listed.activeWorkspaceId, frontendWorkspaceId)
  })
})
