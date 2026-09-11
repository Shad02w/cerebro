import { mkdir, mkdtemp, realpath, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test, type ElectronApplication, type Page } from './fixtures'

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

async function mockChooseFolder(electronApp: ElectronApplication, directory: string): Promise<void> {
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

function multiRootRepoRow(page: Page, repoName: string) {
  return page.locator('[data-slot="sidebar"]').getByTestId(/workspace-row-/).filter({
    has: page.getByTestId(/workspace-repo-/).filter({ hasText: repoName })
  })
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
    await expect(page.getByTestId(/project-multi-root-/)).toHaveCount(0)
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
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)

    await page.getByTestId(`workspace-row-${project?.workspaces[0]?.id}`).click()
    const afterSelect = await page.evaluate(async () => window.cerebro.listProjects())
    expect(afterSelect.activeWorkspaceId).toBe(project?.workspaces[0]?.id)
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adds a folder of git repos as a multi-root workspace', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-multiroot-e2e-'))
  const parent = join(root, 'apps-folder')
  const frontend = join(parent, 'frontend')
  const backend = join(parent, 'backend')

  try {
    await initGitRepo(frontend, 'main', 'frontend-app')
    await initGitRepo(backend, 'main', 'backend-app')
    await addDirectoryViaUi(page, electronApp, parent)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'apps-folder' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })
    await expect(projectRow).toHaveAttribute('data-project-kind', 'multi-root')
    await expect(projectRow).toHaveAttribute('data-project-icon', 'folders')
    await expect(page.getByTestId(/project-multi-root-/)).toHaveText('multi-root')
    await expect(page.getByTestId(/project-add-workspace-/)).toHaveCount(0)
    await expect(projectRow.locator('svg')).toHaveCount(1)

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar.getByTestId(/project-root-/)).toHaveText('root')
    await expect(sidebar.locator('[data-workspace-role="root"]')).toHaveCount(1)
    await expect(sidebar.locator('[data-workspace-icon="folder-tree"]')).toHaveCount(1)
    await expect(sidebar.getByTestId(/project-repo-tree-/)).toBeVisible()
    await expect(sidebar.getByTestId(/project-repo-tree-/)).toHaveCSS('border-left-width', '0px')
    await expect(sidebar.locator('[data-workspace-role="repository"]')).toHaveCount(2)
    await expect(sidebar.locator('[data-workspace-icon="directory-name"]')).toHaveCount(2)
    await expect(sidebar.locator('[data-workspace-icon="branch"]')).toHaveCount(0)

    const backendRow = multiRootRepoRow(page, 'backend')
    const frontendRow = multiRootRepoRow(page, 'frontend')
    await expect(backendRow).toBeVisible()
    await expect(frontendRow).toBeVisible()
    await expect(backendRow.getByTestId(/workspace-repo-/)).toHaveText('backend')
    await expect(frontendRow.getByTestId(/workspace-repo-/)).toHaveText('frontend')
    await expect(backendRow.getByTestId(/workspace-branch-/)).toHaveText('main')
    await expect(frontendRow.getByTestId(/workspace-branch-/)).toHaveText('main')
    await expect(backendRow.locator('svg')).toHaveCount(1)
    await expect(frontendRow.locator('svg')).toHaveCount(1)

    const backendNameBox = await backendRow.getByTestId(/workspace-repo-/).boundingBox()
    const backendBranchBox = await backendRow.getByTestId(/workspace-branch-/).boundingBox()
    const backendBox = await backendRow.boundingBox()
    const frontendBox = await frontendRow.boundingBox()
    expect(backendNameBox).toBeTruthy()
    expect(backendBranchBox).toBeTruthy()
    expect(backendBox).toBeTruthy()
    expect(frontendBox).toBeTruthy()
    expect(backendBranchBox!.y).toBeGreaterThan(backendNameBox!.y)
    expect(backendBranchBox!.x).toBeGreaterThanOrEqual(backendNameBox!.x - 1)
    expect(backendBranchBox!.x - backendNameBox!.x).toBeLessThan(20)
    const innerGap = backendBranchBox!.y - (backendNameBox!.y + backendNameBox!.height)
    const firstBox = backendBox!.y < frontendBox!.y ? backendBox! : frontendBox!
    const secondBox = backendBox!.y < frontendBox!.y ? frontendBox! : backendBox!
    const groupGap = secondBox.y - (firstBox.y + firstBox.height)
    expect(groupGap).toBeGreaterThan(innerGap)

    await projectRow.hover()
    const badge = page.getByTestId(/project-multi-root-/)
    const projectName = projectRow.getByText('apps-folder', { exact: true })
    const projectMenu = page.getByTestId(/project-menu-/)
    const badgeBox = await badge.boundingBox()
    const nameBox = await projectName.boundingBox()
    const menuBox = await projectMenu.boundingBox()
    expect(badgeBox).toBeTruthy()
    expect(nameBox).toBeTruthy()
    expect(menuBox).toBeTruthy()
    expect(nameBox!.x + nameBox!.width).toBeLessThanOrEqual(badgeBox!.x + 1)
    expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(menuBox!.x + 1)

    const workspaceRow = multiRootRepoRow(page, 'frontend')
    const group = sidebar.locator('[data-slot="sidebar-group"]').first()
    const rowBox = await workspaceRow.boundingBox()
    const groupBox = await group.boundingBox()
    expect(rowBox).toBeTruthy()
    expect(groupBox).toBeTruthy()
    expect(groupBox!.x + groupBox!.width - (rowBox!.x + rowBox!.width)).toBeLessThan(16)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'apps-folder')
    expect(project?.kind).toBe('multi-root')
    expect(project?.github).toBeNull()
    expect(project?.repositories.map((repo) => repo.name).sort()).toEqual(['backend', 'frontend'])
    const repoWorkspaces = project?.workspaces.filter((workspace) => workspace.kind === 'default') ?? []
    const rootWorkspace = project?.workspaces.find((workspace) => workspace.kind === 'root')
    expect(repoWorkspaces).toHaveLength(2)
    expect(rootWorkspace).toBeTruthy()
    expect(rootWorkspace?.localPath).toBe(await realpath(parent))

    const backendPath = await realpath(backend)
    const frontendPath = await realpath(frontend)
    const backendWorkspace = project?.workspaces.find(
      (workspace) => workspace.localPath === backendPath
    )
    const frontendWorkspace = project?.workspaces.find(
      (workspace) => workspace.localPath === frontendPath
    )
    expect(backendWorkspace).toBeTruthy()
    expect(frontendWorkspace).toBeTruthy()
    expect(listed.activeWorkspaceId).toBeNull()
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)

    await sidebar.getByTestId(`workspace-row-${frontendWorkspace!.id}`).click()
    const afterSelect = await page.evaluate(async () => window.cerebro.listProjects())
    expect(afterSelect.activeWorkspaceId).toBe(frontendWorkspace!.id)
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('multi-root repos copy path and branch; only the project can be removed', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-multiroot-menu-e2e-'))
  const parent = join(root, 'apps-folder')
  const frontend = join(parent, 'frontend')
  const backend = join(parent, 'backend')

  try {
    await initGitRepo(frontend, 'main', 'frontend-app')
    await initGitRepo(backend, 'develop', 'backend-app')
    await addDirectoryViaUi(page, electronApp, parent)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'apps-folder' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'apps-folder')
    expect(project).toBeTruthy()
    const frontendPath = await realpath(frontend)
    const parentPath = await realpath(parent)
    const frontendWorkspace = project!.workspaces.find(
      (workspace) => workspace.localPath === frontendPath
    )
    expect(frontendWorkspace).toBeTruthy()

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(multiRootRepoRow(page, 'frontend').getByTestId(/workspace-branch-/)).toHaveText(
      'main'
    )
    await expect(multiRootRepoRow(page, 'backend').getByTestId(/workspace-branch-/)).toHaveText(
      'develop'
    )

    const repoRow = sidebar.getByTestId(`workspace-row-${frontendWorkspace!.id}`)
    await repoRow.hover()
    await page.getByTestId(`workspace-menu-${frontendWorkspace!.id}`).click()
    await expect(page.getByTestId(`workspace-${frontendWorkspace!.id}-copy-branch`)).toBeVisible()
    await expect(page.getByTestId(`workspace-${frontendWorkspace!.id}-copy-path`)).toBeVisible()
    await expect(page.getByTestId(`workspace-delete-${frontendWorkspace!.id}`)).toHaveCount(0)
    await expect(page.getByTestId(`workspace-remove-${frontendWorkspace!.id}`)).toHaveCount(0)

    await page.getByTestId(`workspace-${frontendWorkspace!.id}-copy-branch`).click()
    await expect.poll(() => readClipboard(electronApp)).toBe(frontendWorkspace!.branch)

    await repoRow.hover()
    await page.getByTestId(`workspace-menu-${frontendWorkspace!.id}`).click()
    await page.getByTestId(`workspace-${frontendWorkspace!.id}-copy-path`).click()
    await expect.poll(() => readClipboard(electronApp)).toBe(frontendPath)

    const rootRow = sidebar.getByTestId(`project-root-${project!.id}`)
    const rootToggle = page.getByTestId(`root-toggle-${project!.id}`)
    const rootMenu = page.getByTestId(`root-menu-${project!.id}`)
    await expect(rootToggle).toHaveCSS('opacity', '0')
    await expect(rootMenu).toHaveCSS('opacity', '0')
    await rootRow.hover()
    await expect(rootToggle).toHaveCSS('opacity', '1')
    await expect(rootMenu).toHaveCSS('opacity', '1')
    const toggleBox = await rootToggle.boundingBox()
    const menuBox = await rootMenu.boundingBox()
    expect(toggleBox).toBeTruthy()
    expect(menuBox).toBeTruthy()
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(menuBox!.x + 1)
    await rootMenu.click()
    await expect(page.getByTestId(`root-${project!.id}-copy-branch`)).toBeDisabled()
    await expect(page.getByTestId(`root-${project!.id}-copy-path`)).toBeVisible()
    await expect(page.getByTestId(`project-delete-${project!.id}`)).toHaveCount(0)
    await page.getByTestId(`root-${project!.id}-copy-path`).click()
    await expect.poll(() => readClipboard(electronApp)).toBe(parentPath)

    await expect(sidebar.getByTestId(`project-repo-tree-${project!.id}`)).toBeVisible()
    await rootRow.hover()
    await rootToggle.click()
    await expect(sidebar.getByTestId(`project-repo-tree-${project!.id}`)).toBeHidden()
    await expect(repoRow).toBeHidden()
    await rootRow.hover()
    await rootToggle.click()
    await expect(sidebar.getByTestId(`project-repo-tree-${project!.id}`)).toBeVisible()
    await expect(repoRow).toBeVisible()

    await rootRow.click()
    const afterRootSelect = await page.evaluate(async () => window.cerebro.listProjects())
    const selectedRoot = afterRootSelect.projects
      .find((item) => item.id === project!.id)
      ?.workspaces.find((workspace) => workspace.kind === 'root')
    expect(selectedRoot).toBeTruthy()
    expect(afterRootSelect.activeWorkspaceId).toBe(selectedRoot!.id)
    expect(selectedRoot!.localPath).toBe(parentPath)
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)
    await expect(sidebar.getByTestId(`project-repo-tree-${project!.id}`)).toBeVisible()

    await projectRow.hover()
    await page.getByTestId(`project-menu-${project!.id}`).click()
    await expect(page.getByTestId(`project-delete-${project!.id}`)).toBeVisible()
    await expect(page.getByTestId(`project-remove-${project!.id}`)).toBeVisible()
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

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'plain-folder' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })
    await expect(projectRow).toHaveAttribute('data-project-kind', 'directory')
    await expect(page.getByTestId(/project-add-workspace-/)).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'plain-folder')
    expect(project?.kind).toBe('directory')
    expect(project?.repositories).toHaveLength(1)
    expect(project?.repositories[0]?.localPath).toBe(await realpath(folder))
    expect(project?.workspaces).toHaveLength(1)
    expect(listed.activeWorkspaceId).toBeNull()
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)

    await page.getByTestId(`workspace-row-${project?.workspaces[0]?.id}`).click()
    const afterSelect = await page.evaluate(async () => window.cerebro.listProjects())
    expect(afterSelect.activeWorkspaceId).toBe(project?.workspaces[0]?.id)
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('upgrades an opened git folder after sibling git repos appear', async ({
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

    await expect(projectRow).toHaveAttribute('data-project-kind', 'multi-root', { timeout: 30_000 })
    await expect(projectRow).toHaveAttribute('data-project-icon', 'folders')
    await expect(page.getByTestId(/project-multi-root-/)).toHaveText('multi-root')
    await expect(page.getByTestId(/project-root-/)).toHaveText('root')
    await expect(multiRootRepoRow(page, 'ark-ui')).toBeVisible()
    await expect(multiRootRepoRow(page, 'other-app')).toBeVisible()
    await expect(multiRootRepoRow(page, 'ark-ui').getByTestId(/workspace-branch-/)).toHaveText('main')
    await expect(multiRootRepoRow(page, 'other-app').getByTestId(/workspace-branch-/)).toHaveText(
      'main'
    )

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'abc')
    expect(project?.kind).toBe('multi-root')
    expect(project?.repositories.map((repo) => repo.name).sort()).toEqual(['ark-ui', 'other-app'])
    expect(project?.workspaces.find((workspace) => workspace.kind === 'root')?.localPath).toBe(
      await realpath(parent)
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('treats leftover submodule siblings as roots in a multi-root folder', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-submodule-e2e-'))
  const parent = join(root, 'lab-folder')
  const realRepo = join(parent, 'app')
  const brokenSubmodule = join(parent, 'ark-ui')

  try {
    await initGitRepo(realRepo, 'main', 'lab-app')
    await mkdir(brokenSubmodule, { recursive: true })
    await writeFile(join(brokenSubmodule, '.git'), 'gitdir: ../.git/modules/ark-ui\n')

    await addDirectoryViaUi(page, electronApp, parent)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'lab-folder' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })
    await expect(projectRow).toHaveAttribute('data-project-kind', 'multi-root')
    await expect(projectRow).toHaveAttribute('data-project-icon', 'folders')
    await expect(page.getByTestId(/project-multi-root-/)).toHaveText('multi-root')
    await expect(multiRootRepoRow(page, 'app')).toBeVisible()
    await expect(multiRootRepoRow(page, 'ark-ui')).toBeVisible()
    await expect(multiRootRepoRow(page, 'app').getByTestId(/workspace-branch-/)).toHaveText('main')
    await expect(multiRootRepoRow(page, 'ark-ui').getByTestId(/workspace-branch-/)).toHaveCount(0)
    await expect(page.getByTestId(/project-root-/)).toHaveText('root')
    await expect(page.locator('[data-workspace-icon="folder-tree"]')).toHaveCount(1)
    await expect(page.locator('[data-workspace-icon="directory-name"]')).toHaveCount(2)
    await expect(page.locator('[data-workspace-icon="repository"]')).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'lab-folder')
    expect(project?.kind).toBe('multi-root')
    expect(project?.repositories.map((repo) => repo.name).sort()).toEqual(['app', 'ark-ui'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('treats a git folder with sibling git repos as multi-root', async ({ page, electronApp }) => {
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
    await expect(projectRow).toHaveAttribute('data-project-kind', 'multi-root')
    await expect(projectRow).toHaveAttribute('data-project-icon', 'folders')
    await expect(page.getByTestId(/project-multi-root-/)).toHaveText('multi-root')
    await expect(page.getByTestId(/project-root-/)).toHaveText('root')
    await expect(multiRootRepoRow(page, 'ark-ui')).toBeVisible()
    await expect(multiRootRepoRow(page, 'other-app')).toBeVisible()
    await expect(multiRootRepoRow(page, 'ark-ui').getByTestId(/workspace-branch-/)).toHaveText('main')
    await expect(multiRootRepoRow(page, 'other-app').getByTestId(/workspace-branch-/)).toHaveText(
      'main'
    )

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'abc')
    expect(project?.kind).toBe('multi-root')
    expect(project?.repositories.map((repo) => repo.name).sort()).toEqual(['ark-ui', 'other-app'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adds a leftover submodule folder as a normal directory project', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-broken-git-e2e-'))
  const submodule = join(root, 'ark-ui')

  try {
    await mkdir(submodule, { recursive: true })
    await writeFile(join(submodule, '.git'), 'gitdir: ../.git/modules/ark-ui\n')
    await writeFile(join(submodule, 'README.md'), 'ark-ui\n')

    await addDirectoryViaUi(page, electronApp, submodule)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'ark-ui' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })
    await expect(projectRow).toHaveAttribute('data-project-kind', 'directory')
    await expect(page.getByText(/Git could not open it/i)).toHaveCount(0)
    await expect(page.getByText(/Error invoking remote method/i)).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'ark-ui')
    expect(project?.kind).toBe('directory')
    expect(project?.repositories[0]?.localPath).toBe(await realpath(submodule))
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
