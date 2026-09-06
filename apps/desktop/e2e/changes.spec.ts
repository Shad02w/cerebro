import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
  await expect(page.getByTestId(/project-row-/).filter({ hasText: basename(directory) })).toBeVisible(
    {
      timeout: 30_000
    }
  )
}

async function listedProject(page: Page, name: string) {
  const listed = await page.evaluate(async () => window.cerebro.listProjects())
  return listed.projects.find((item) => item.name === name)
}

async function selectDefaultWorkspace(page: Page, projectName: string): Promise<void> {
  const project = await listedProject(page, projectName)
  const workspaceId = project?.workspaces[0]?.id
  expect(workspaceId).toBeTruthy()
  await page.getByTestId(`workspace-row-${workspaceId}`).click()
}

async function openChanges(page: Page): Promise<void> {
  await page.getByTestId('open-changes-tab').click()
  await expect(page.getByTestId('changes-tab')).toBeVisible()
  await expect(activeChanges(page)).toBeVisible()
}

function activeChanges(page: Page) {
  return page.locator('[data-testid="changes-view"][data-active="true"]')
}

function closeChord(): string {
  return process.platform === 'darwin' ? 'Meta+w' : 'Control+w'
}

test('shows working-tree diffs in a Changes tab with a right-hand file list', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-e2e-'))
  const repo = join(root, 'changed-alpha')

  try {
    await initGitRepo(repo, 'main', 'changed-alpha')
    await writeFile(join(repo, 'README.md'), 'changed-alpha\nhello from changes\n')
    await addDirectoryViaUi(page, electronApp, repo)
    await selectDefaultWorkspace(page, 'changed-alpha')
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()

    await openChanges(page)
    const pane = activeChanges(page)
    const sidebar = pane.getByTestId('changes-sidebar')
    const diff = pane.getByTestId('changes-diff')
    await expect(sidebar).toBeVisible()
    const fileRow = pane.getByTestId('changes-file-row').filter({ hasText: 'README.md' })
    await expect(fileRow).toBeVisible({ timeout: 15_000 })
    await expect(fileRow).toHaveAttribute('data-path', 'README.md')
    await expect(diff).toContainText('hello from changes', {
      timeout: 15_000
    })
    const [diffBox, sidebarBox] = await Promise.all([diff.boundingBox(), sidebar.boundingBox()])
    expect(diffBox).toBeTruthy()
    expect(sidebarBox).toBeTruthy()
    expect(sidebarBox!.x).toBeGreaterThan(diffBox!.x + (diffBox!.width ?? 0) / 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('toggles the Changes sidebar between flat and tree for nested paths', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-tree-e2e-'))
  const repo = join(root, 'changed-tree')

  try {
    await initGitRepo(repo, 'main', 'changed-tree')
    await mkdir(join(repo, 'src', 'util'), { recursive: true })
    await writeFile(join(repo, 'src', 'util', 'hello.ts'), 'export const hello = "world"\n')
    await addDirectoryViaUi(page, electronApp, repo)
    await selectDefaultWorkspace(page, 'changed-tree')

    await openChanges(page)
    const pane = activeChanges(page)
    await expect(pane.getByTestId('changes-file-list')).toHaveAttribute('data-mode', 'flat')
    const fileRow = pane.getByTestId('changes-file-row')
    await expect(fileRow).toHaveAttribute('data-path', 'src/util/hello.ts')
    await expect(fileRow).toHaveText(/src\/util\/hello\.ts/)
    await expect(pane.getByTestId('changes-tree-dir')).toHaveCount(0)

    await pane.getByTestId('changes-mode-tree').click()
    await expect(pane.getByTestId('changes-file-list')).toHaveAttribute('data-mode', 'tree')
    await expect(pane.locator('[data-testid="changes-tree-dir"][data-path="src"]')).toBeVisible()
    await expect(pane.locator('[data-testid="changes-tree-dir"][data-path="src/util"]')).toBeVisible()
    await expect(fileRow).toHaveAttribute('data-path', 'src/util/hello.ts')
    await expect(fileRow).not.toHaveText(/src\/util/)

    await pane.getByTestId('changes-mode-flat').click()
    await expect(pane.getByTestId('changes-file-list')).toHaveAttribute('data-mode', 'flat')
    await expect(pane.getByTestId('changes-tree-dir')).toHaveCount(0)
    await expect(fileRow).toHaveText(/src\/util\/hello\.ts/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('groups multi-root changes by repo on the root workspace and scopes nested repos', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-multiroot-e2e-'))
  const parent = join(root, 'apps-folder')
  const frontend = join(parent, 'frontend')
  const backend = join(parent, 'backend')

  try {
    await initGitRepo(frontend, 'main', 'frontend-app')
    await initGitRepo(backend, 'main', 'backend-app')
    await writeFile(join(frontend, 'README.md'), 'frontend-app\nfront-change\n')
    await writeFile(join(backend, 'README.md'), 'backend-app\nback-change\n')
    await addDirectoryViaUi(page, electronApp, parent)

    const project = await listedProject(page, 'apps-folder')
    const frontendWorkspace = project?.workspaces.find(
      (workspace) => workspace.kind !== 'root' && workspace.localPath.endsWith('frontend')
    )
    expect(project?.id).toBeTruthy()
    expect(frontendWorkspace?.id).toBeTruthy()

    await page.getByTestId(`project-root-${project?.id}`).click()
    await openChanges(page)
    const rootChanges = activeChanges(page)
    await expect(
      rootChanges.getByTestId('changes-repo-header').filter({ hasText: 'backend' })
    ).toBeVisible({
      timeout: 15_000
    })
    await expect(
      rootChanges.getByTestId('changes-repo-header').filter({ hasText: 'frontend' })
    ).toBeVisible()
    await expect(rootChanges.getByTestId('changes-file-row')).toHaveCount(2)
    await expect(rootChanges.getByTestId('changes-diff')).toContainText('front-change')
    await expect(rootChanges.getByTestId('changes-diff')).toContainText('back-change')

    await page.getByTestId(`workspace-row-${frontendWorkspace?.id}`).click()
    await openChanges(page)
    const repoChanges = activeChanges(page)
    await expect(repoChanges.getByTestId('changes-file-row')).toHaveCount(1, { timeout: 15_000 })
    await expect(repoChanges.getByTestId('changes-repo-header')).toHaveCount(0)
    await expect(repoChanges.getByTestId('changes-diff')).toContainText('front-change')
    await expect(repoChanges.getByTestId('changes-diff')).not.toContainText('back-change')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps terminals when opening and closing a Changes tab', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-tabs-e2e-'))
  const repo = join(root, 'changed-tabs')

  try {
    await initGitRepo(repo, 'main', 'changed-tabs')
    await writeFile(join(repo, 'README.md'), 'changed-tabs\nnote\n')
    await addDirectoryViaUi(page, electronApp, repo)
    await selectDefaultWorkspace(page, 'changed-tabs')

    await page.getByTestId('new-terminal-tab').click()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
    await expect(page.locator('[data-terminal-active="true"] .xterm')).toBeVisible({
      timeout: 30_000
    })

    await openChanges(page)
    await expect(page.getByTestId('changes-tab')).toBeVisible()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
    await expect(activeChanges(page)).toHaveCSS('visibility', 'visible')

    await page.keyboard.press(closeChord())
    await expect(page.getByTestId('changes-tab')).toHaveCount(0)
    await expect(page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 1' })).toBeVisible()
    await expect(page.locator('[data-terminal-active="true"] .xterm')).toBeVisible()
    expect(electronApp.windows().length).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('shows an empty state when the working tree is clean', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-empty-e2e-'))
  const repo = join(root, 'changed-empty')

  try {
    await initGitRepo(repo, 'main', 'changed-empty')
    await addDirectoryViaUi(page, electronApp, repo)
    await selectDefaultWorkspace(page, 'changed-empty')

    await openChanges(page)
    await expect(page.getByTestId('changes-empty')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('changes-sidebar-empty')).toBeVisible()
    await expect(page.getByTestId('changes-file-row')).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
