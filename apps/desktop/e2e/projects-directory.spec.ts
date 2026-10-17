import { mkdir, mkdtemp, realpath, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures'

const execFileAsync = promisify(execFile)

async function initGitRepo(dir: string, branch: string, marker: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await execFileAsync('git', ['init', '-b', branch], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'e2e@cerebro.local'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Cerebro E2E'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), `${marker}\n`)
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', `init ${marker}`], { cwd: dir })
}

async function mockChooseFolder(
  electronApp: ElectronApplication,
  directory: string
): Promise<void> {
  await electronApp.evaluate(async ({ dialog }, dir: string) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, directory)
}

async function addDirectoryViaUi(
  page: Page,
  electronApp: ElectronApplication,
  directory: string
): Promise<void> {
  await mockChooseFolder(electronApp, directory)
  await page.getByRole('button', { name: 'Add project' }).first().click()
  await page.getByTestId('add-project-choose-folder').click()
}

async function readClipboard(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(({ clipboard }) => clipboard.readText())
}

test('adds a local git folder as a directory project', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-dir-e2e-'))
  const repo = join(root, 'opened-alpha')

  try {
    await initGitRepo(repo, 'main', 'opened-alpha')
    await addDirectoryViaUi(page, electronApp, repo)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'opened-alpha' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })
    await expect(projectRow).toHaveAttribute('data-project-kind', 'directory')
    await expect(projectRow).toHaveAttribute('data-project-icon', 'folder')
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toBeVisible()
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toHaveAttribute(
      'data-workspace-icon',
      'branch'
    )
    await expect(page.getByTestId(/project-add-workspace-/)).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'opened-alpha')
    expect(project?.kind).toBe('directory')
    expect(project?.repositories).toHaveLength(1)
    expect(project?.repositories[0]?.localPath).toBe(await realpath(repo))
    expect(project?.workspaces).toHaveLength(1)
    expect(listed.activeWorkspaceId).toBeNull()
    await expect(page.getByTestId('content-tab-bar')).toHaveCount(0)

    const selected = page.getByTestId(`workspace-row-${project?.workspaces[0]?.id}`)
    await selected.click()
    await expect(selected).toHaveAttribute('aria-current', 'location')
    const afterSelect = await page.evaluate(async () => window.cerebro.listProjects())
    expect(afterSelect.activeWorkspaceId).toBe(project?.workspaces[0]?.id)
    await expect(page.getByTestId('content-tab-bar')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adds a folder of git repos as one workspace', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-siblings-e2e-'))
  const parent = join(root, 'apps-folder')
  const frontend = join(parent, 'frontend')
  const backend = join(parent, 'backend')

  try {
    await initGitRepo(frontend, 'main', 'frontend-app')
    await initGitRepo(backend, 'develop', 'backend-app')
    await addDirectoryViaUi(page, electronApp, parent)

    const row = page.getByTestId(/workspace-row-/).filter({ hasText: 'apps-folder' })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toHaveAttribute('data-workspace-role', 'directory')
    await expect(row).toHaveAttribute('data-project-kind', 'directory')
    await expect(page.getByTestId(/project-row-/)).toHaveCount(0)
    await expect(page.getByTestId(/project-add-workspace-/)).toHaveCount(0)
    await expect(page.getByTestId(/workspace-multi-root-/)).toHaveText('multi-root')
    await expect(row).toHaveClass(/sidebar-project-button/)
    await expect(row).toHaveClass(/text-xs/)
    await expect(row).toHaveClass(/text-sidebar-foreground\/60/)
    const group = page.getByTestId(/workspace-root-/)
    await expect(group.getByTestId('workspace-nested-repo-frontend')).toBeVisible()
    await expect(group.getByTestId('workspace-nested-branch-frontend')).toHaveText('main')
    await expect(group.getByTestId('workspace-nested-repo-backend')).toBeVisible()
    await expect(group.getByTestId('workspace-nested-branch-backend')).toHaveText('develop')
    await expect(
      group.locator('[data-workspace-role="repository"] [data-row-label]').first()
    ).toHaveClass(/text-sidebar-foreground\/60/)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    expect(listed.projects).toHaveLength(1)
    const project = listed.projects[0]
    expect(project?.kind).toBe('directory')
    expect(project?.name).toBe('apps-folder')
    expect(project?.repositories).toHaveLength(1)
    expect(project?.repositories[0]?.localPath).toBe(await realpath(parent))
    expect(project?.repositories[0]?.defaultBranch).toBe('')
    expect(project?.workspaces).toHaveLength(1)
    expect(project?.workspaces[0]?.kind).toBe('default')
    expect(listed.activeWorkspaceId).toBeNull()
    await expect(page.getByTestId('content-tab-bar')).toHaveCount(0)

    await addDirectoryViaUi(page, electronApp, frontend)
    await expect(page.getByTestId(/project-row-/)).toHaveCount(0)
    await expect(page.getByTestId(/workspace-row-/)).toHaveCount(2)
    await expect(group.getByTestId('workspace-nested-repo-frontend')).toBeVisible()
    const nestedFrontend = group
      .getByTestId('workspace-nested-repo-frontend')
      .locator('[data-workspace-role="repository"]')
    await nestedFrontend.click()
    await expect(nestedFrontend).toHaveAttribute('aria-current', 'location')
    await group.getByTestId(/workspace-nested-toggle-/).click()
    await expect(group.getByTestId('workspace-nested-repo-frontend')).toBeHidden()
    await expect(row).toBeVisible()

    const workspaceId = project?.workspaces[0]?.id
    await page.getByTestId(`workspace-row-${workspaceId}`).locator('[data-row-label]').click()
    await expect(row).toHaveAttribute('aria-current', 'location')
    await expect
      .poll(async () => {
        const selected = await page.evaluate(async () => window.cerebro.listProjects())
        return selected.activeWorkspaceId
      })
      .toBe(workspaceId)
    await expect(page.getByTestId('content-tab-bar')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a plain directory copies its path and can be removed from its row', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-plain-menu-e2e-'))
  const folder = join(root, 'notes')

  try {
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'notes.txt'), 'hello\n')
    await addDirectoryViaUi(page, electronApp, folder)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'notes')
    const workspace = project?.workspaces[0]
    expect(workspace?.id).toBeTruthy()
    const folderPath = await realpath(folder)
    const row = page.getByTestId(`workspace-row-${workspace!.id}`)
    await expect(row).toHaveAttribute('data-workspace-role', 'directory')

    await row.hover()
    await page.getByTestId(`workspace-menu-${workspace!.id}`).click()
    await page.getByTestId(`workspace-${workspace!.id}-copy-path`).click()
    await expect.poll(() => readClipboard(electronApp)).toBe(folderPath)

    await row.hover()
    await page.getByTestId(`workspace-menu-${workspace!.id}`).click()
    await page.getByTestId(`project-remove-${project!.id}`).click()
    await expect(row).toHaveCount(0)
    await access(folder)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adds a folder even when it is not a git repository', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-plain-e2e-'))
  const folder = join(root, 'plain-folder')

  try {
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'notes.txt'), 'hello\n')
    await addDirectoryViaUi(page, electronApp, folder)

    const row = page.getByTestId(/workspace-row-/).filter({ hasText: 'plain-folder' })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toHaveAttribute('data-workspace-role', 'directory')
    await expect(row).toHaveAttribute('data-workspace-icon', 'folder')
    await expect(page.getByTestId(/project-row-/)).toHaveCount(0)
    await expect(page.getByTestId(/project-add-workspace-/)).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'plain-folder')
    expect(project?.kind).toBe('directory')
    expect(project?.repositories).toHaveLength(1)
    expect(project?.repositories[0]?.localPath).toBe(await realpath(folder))
    expect(project?.workspaces).toHaveLength(1)
    expect(listed.activeWorkspaceId).toBeNull()
    await expect(page.getByTestId('content-tab-bar')).toHaveCount(0)

    const selected = page.getByTestId(`workspace-row-${project?.workspaces[0]?.id}`)
    await selected.click()
    await expect(selected).toHaveAttribute('aria-current', 'location')
    const afterSelect = await page.evaluate(async () => window.cerebro.listProjects())
    expect(afterSelect.activeWorkspaceId).toBe(project?.workspaces[0]?.id)
    await expect(page.getByTestId('content-tab-bar')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('does not regroup an opened git folder when sibling repositories appear', async ({
  page,
  electronApp
}) => {
  const tmp = await mkdtemp(join(tmpdir(), 'cerebro-upgrade-e2e-'))
  const parent = join(tmp, 'abc')

  try {
    await initGitRepo(parent, 'main', 'abc-parent')
    await addDirectoryViaUi(page, electronApp, parent)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'abc' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })
    await expect(projectRow).toHaveAttribute('data-project-kind', 'directory')
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toBeVisible()

    await initGitRepo(join(parent, 'ark-ui'), 'main', 'ark-ui')
    await initGitRepo(join(parent, 'other-app'), 'main', 'other-app')
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    await expect(projectRow).toHaveAttribute('data-project-kind', 'directory', { timeout: 30_000 })
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toBeVisible()
    await expect(page.getByText('ark-ui', { exact: true })).toHaveCount(0)
    await expect(page.getByText('other-app', { exact: true })).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'abc')
    expect(listed.projects).toHaveLength(1)
    expect(project?.kind).toBe('directory')
    expect(project?.repositories).toHaveLength(1)
    expect(project?.repositories[0]?.localPath).toBe(await realpath(parent))
    expect(project?.workspaces).toHaveLength(1)
    expect(project?.workspaces[0]?.branch).toBe('main')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('does not import child repos from a non-git folder', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-submodule-e2e-'))
  const parent = join(root, 'lab-folder')
  const realRepo = join(parent, 'app')
  const brokenSubmodule = join(parent, 'ark-ui')

  try {
    await initGitRepo(realRepo, 'main', 'lab-app')
    await mkdir(brokenSubmodule, { recursive: true })
    await writeFile(join(brokenSubmodule, '.git'), 'gitdir: ../.git/modules/ark-ui\n')

    await addDirectoryViaUi(page, electronApp, parent)

    const row = page.getByTestId(/workspace-row-/).filter({ hasText: 'lab-folder' })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toHaveAttribute('data-workspace-role', 'directory')
    await expect(page.getByTestId(/project-row-/)).toHaveCount(0)
    await expect(page.getByTestId('workspace-nested-repo-app')).toBeVisible()
    await expect(page.getByTestId('workspace-nested-branch-app')).toHaveText('main')
    await expect(page.getByText('ark-ui', { exact: true })).toHaveCount(0)
    await expect(row.getByTestId(/workspace-multi-root-/)).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    expect(listed.projects).toHaveLength(1)
    expect(listed.projects[0]?.repositories[0]?.localPath).toBe(await realpath(parent))
    expect(listed.projects[0]?.workspaces).toHaveLength(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adds a git folder itself when it contains sibling git repos', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-parentgit-e2e-'))
  const parent = join(root, 'abc')
  const arkUi = join(parent, 'ark-ui')
  const other = join(parent, 'other-app')

  try {
    await initGitRepo(parent, 'main', 'abc-parent')
    await initGitRepo(arkUi, 'main', 'ark-ui')
    await initGitRepo(other, 'main', 'other-app')
    await addDirectoryViaUi(page, electronApp, parent)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'abc' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })
    await expect(projectRow).toHaveAttribute('data-project-kind', 'directory')
    await expect(projectRow).toHaveAttribute('data-project-icon', 'folder')
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toBeVisible()
    await expect(page.getByText('ark-ui', { exact: true })).toHaveCount(0)
    await expect(page.getByText('other-app', { exact: true })).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'abc')
    expect(listed.projects).toHaveLength(1)
    expect(project?.kind).toBe('directory')
    expect(project?.repositories.map((repo) => repo.localPath)).toEqual([await realpath(parent)])
    expect(project?.workspaces.map((workspace) => workspace.branch)).toEqual(['main'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adds a leftover submodule folder as its own workspace', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-broken-git-e2e-'))
  const submodule = join(root, 'ark-ui')

  try {
    await mkdir(submodule, { recursive: true })
    await writeFile(join(submodule, '.git'), 'gitdir: ../.git/modules/ark-ui\n')
    await writeFile(join(submodule, 'README.md'), 'ark-ui\n')

    await addDirectoryViaUi(page, electronApp, submodule)

    const row = page.getByTestId(/workspace-row-/).filter({ hasText: 'ark-ui' })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toHaveAttribute('data-workspace-role', 'directory')
    await expect(row).toHaveAttribute('data-project-kind', 'directory')
    await expect(page.getByTestId(/project-row-/)).toHaveCount(0)
    await expect(page.getByText(/Git could not open it/i)).toHaveCount(0)
    await expect(page.getByText(/Error invoking remote method/i)).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'ark-ui')
    expect(project?.kind).toBe('directory')
    expect(project?.repositories[0]?.localPath).toBe(await realpath(submodule))
    expect(project?.workspaces).toHaveLength(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('remove from app unregisters a directory project but keeps the folder', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-dir-remove-e2e-'))
  const repo = join(root, 'opened-beta')

  try {
    await initGitRepo(repo, 'main', 'opened-beta')
    await addDirectoryViaUi(page, electronApp, repo)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'opened-beta' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })

    const project = await page.evaluate(async () => {
      const listed = await window.cerebro.listProjects()
      return listed.projects.find((item) => item.name === 'opened-beta') ?? null
    })
    expect(project).not.toBeNull()

    const defaultWorkspace = project!.workspaces.find((workspace) => workspace.kind === 'default')
    expect(defaultWorkspace).toBeTruthy()

    await page.getByTestId(`workspace-row-${defaultWorkspace!.id}`).hover()
    await page.getByTestId(`workspace-menu-${defaultWorkspace!.id}`).click()
    await expect(
      page.getByTestId(`workspace-delete-${defaultWorkspace!.id}`).getByRole('menuitem', {
        name: 'Delete'
      })
    ).toBeDisabled()
    await page.keyboard.press('Escape')

    // Let the hover-open delay expire after Radix restores menu-button focus.
    await page.waitForTimeout(500)
    await expect(page.getByTestId(`workspace-hover-${defaultWorkspace!.id}`)).toBeHidden()

    await page.getByTestId(`project-row-${project!.id}`).hover()
    await page.getByTestId(`project-menu-${project!.id}`).click()
    await page.getByTestId(`project-remove-${project!.id}`).click()

    await expect(page.getByTestId(`project-row-${project!.id}`)).toHaveCount(0)
    await access(repo)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    expect(listed.projects.find((item) => item.name === 'opened-beta')).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('project delete leaves an opened-folder checkout on disk', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-dir-delete-e2e-'))
  const repo = join(root, 'opened-gamma')

  try {
    await initGitRepo(repo, 'main', 'opened-gamma')
    await addDirectoryViaUi(page, electronApp, repo)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'opened-gamma' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })

    const project = await page.evaluate(async () => {
      const listed = await window.cerebro.listProjects()
      return listed.projects.find((item) => item.name === 'opened-gamma') ?? null
    })
    expect(project).not.toBeNull()

    await page.getByTestId(`project-row-${project!.id}`).hover()
    await page.getByTestId(`project-menu-${project!.id}`).click()
    await page.getByTestId(`project-delete-${project!.id}`).click()

    await expect(page.getByTestId(`project-row-${project!.id}`)).toHaveCount(0)
    await access(repo)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
