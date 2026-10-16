import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
  await execFileAsync('git', ['config', 'user.email', 'test@cerebro.local'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Cerebro Test'], { cwd: dir })
  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
}

test('a non-git directory is one workspace and ignores sibling repositories', async () => {
  await withHome('cerebro-plain-dir-', async (home) => {
    const parent = join(home, 'apps')
    await initGitRepo(join(parent, 'frontend'), 'main')
    await initGitRepo(join(parent, 'backend'), 'develop')
    await mkdir(join(parent, 'notes'), { recursive: true })

    const project = await createProjectFromDirectory(parent)
    assert.equal(project.kind, 'directory')
    assert.equal(project.repositories.length, 1)
    assert.equal(project.repositories[0]?.defaultBranch, '')
    assert.equal(project.repositories[0]?.localPath, parent)
    assert.equal(project.workspaces.length, 1)
    assert.equal(project.workspaces[0]?.kind, 'default')
    assert.equal(project.workspaces[0]?.branch, '')
    assert.equal(project.workspaces[0]?.localPath, parent)

    const listed = await listProjects()
    assert.equal(listed.projects.length, 1)
    assert.equal(
      listed.projects.some((item) => item.kind === 'multi-root'),
      false
    )
  })
})

test('a git checkout stays its own project when sibling repositories exist', async () => {
  await withHome('cerebro-git-dir-', async (home) => {
    const parent = join(home, 'suite')
    await initGitRepo(parent, 'main')
    await initGitRepo(join(parent, 'other'), 'main')

    const project = await createProjectFromDirectory(parent)
    assert.equal(project.kind, 'directory')
    assert.equal(project.repositories.length, 1)
    assert.equal(project.repositories[0]?.localPath, parent)
    assert.equal(project.repositories[0]?.defaultBranch, 'main')
    assert.equal(project.workspaces.length, 1)
    assert.equal(project.workspaces[0]?.branch, 'main')
    assert.equal((await listProjects()).projects.length, 1)
  })
})

test('a worktree joins the project of its git repository', async () => {
  await withHome('cerebro-worktree-dir-', async (home) => {
    const repo = join(home, 'notes')
    const worktree = join(home, 'notes-feature')
    await initGitRepo(repo, 'main')
    await execFileAsync('git', ['branch', 'feature'], { cwd: repo })
    await execFileAsync('git', ['worktree', 'add', worktree, 'feature'], { cwd: repo })

    const created = await createProjectFromDirectory(repo)
    const joined = await createProjectFromDirectory(worktree)
    assert.equal(joined.id, created.id)
    assert.equal(joined.workspaces.length, 2)
    const branches = joined.workspaces.map((workspace) => workspace.branch).sort()
    assert.deepEqual(branches, ['feature', 'main'])
    assert.equal(
      joined.workspaces.find((workspace) => workspace.localPath === worktree)?.kind,
      'worktree'
    )
    assert.equal((await listProjects()).projects.length, 1)
  })
})

test('adding the main checkout after a worktree keeps the main checkout as the default workspace', async () => {
  await withHome('cerebro-worktree-first-', async (home) => {
    const repo = join(home, 'notes')
    const worktree = join(home, 'notes-feature')
    await initGitRepo(repo, 'main')
    await execFileAsync('git', ['branch', 'feature'], { cwd: repo })
    await execFileAsync('git', ['worktree', 'add', worktree, 'feature'], { cwd: repo })

    const created = await createProjectFromDirectory(worktree)
    const joined = await createProjectFromDirectory(repo)
    assert.equal(joined.id, created.id)
    assert.equal(
      joined.workspaces.find((workspace) => workspace.localPath === repo)?.kind,
      'default'
    )
    assert.equal(
      joined.workspaces.find((workspace) => workspace.localPath === worktree)?.kind,
      'worktree'
    )
  })
})

test('legacy multi-root projects split into separate git projects and a parent workspace', async () => {
  await withHome('cerebro-split-multiroot-', async (home) => {
    const parent = join(home, 'apps')
    const frontend = join(parent, 'frontend')
    const backend = join(parent, 'backend')
    await initGitRepo(frontend, 'main')
    await initGitRepo(backend, 'develop')

    const db = getDb()
    const project = db
      .prepare(`INSERT INTO projects (name, kind) VALUES ('apps', 'multi-root')`)
      .run()
    const projectId = Number(project.lastInsertRowid)
    const insertRepo = db.prepare(
      `
INSERT INTO repositories (project_id, git_url, name, local_path, default_branch)
VALUES (?, ?, ?, ?, ?)
      `
    )
    const frontendRepo = insertRepo.run(projectId, 'file://frontend', 'frontend', frontend, 'main')
    const backendRepo = insertRepo.run(projectId, 'file://backend', 'backend', backend, 'develop')
    const insertWorkspace = db.prepare(
      `
INSERT INTO workspaces (project_id, repository_id, kind, branch, local_path)
VALUES (?, ?, ?, ?, ?)
      `
    )
    const rootWorkspace = insertWorkspace.run(
      projectId,
      Number(frontendRepo.lastInsertRowid),
      'root',
      '.',
      parent
    )
    const frontendWorkspace = insertWorkspace.run(
      projectId,
      Number(frontendRepo.lastInsertRowid),
      'default',
      'main',
      frontend
    )
    insertWorkspace.run(
      projectId,
      Number(backendRepo.lastInsertRowid),
      'default',
      'develop',
      backend
    )

    const listed = await listProjects()
    assert.equal(
      listed.projects.some((item) => item.kind === 'multi-root'),
      false
    )
    assert.equal(listed.projects.length, 3)
    const parentProject = listed.projects.find((item) => item.repositories[0]?.localPath === parent)
    const frontendProject = listed.projects.find(
      (item) => item.repositories[0]?.localPath === frontend
    )
    const backendProject = listed.projects.find(
      (item) => item.repositories[0]?.localPath === backend
    )
    assert.ok(parentProject)
    assert.equal(parentProject?.repositories[0]?.defaultBranch, '')
    assert.equal(parentProject?.workspaces.length, 1)
    assert.equal(parentProject?.workspaces[0]?.kind, 'default')
    assert.equal(parentProject?.workspaces[0]?.localPath, parent)
    assert.equal(parentProject?.workspaces[0]?.id, Number(rootWorkspace.lastInsertRowid))
    assert.equal(frontendProject?.workspaces[0]?.id, Number(frontendWorkspace.lastInsertRowid))
    assert.equal(frontendProject?.workspaces[0]?.branch, 'main')
    assert.equal(backendProject?.workspaces[0]?.branch, 'develop')
    assert.notEqual(frontendProject?.id, backendProject?.id)
  })
})
