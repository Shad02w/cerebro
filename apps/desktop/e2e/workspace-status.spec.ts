import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Workspace } from '@cerebro/core'
import type { Locator } from '@playwright/test'
import { expect, test, type ElectronApplication, type Page } from './fixtures'

const execFileAsync = promisify(execFile)
const cliPath = resolve(__dirname, '../../cli/dist/index.js')
const artifacts = '/opt/cursor/artifacts'

test.beforeAll(async () => {
  await mkdir(artifacts, { recursive: true })
  await execFileAsync('pnpm', ['--filter', '@cerebro/core', 'build'], {
    cwd: resolve(__dirname, '../../..')
  })
  await execFileAsync('pnpm', ['--filter', '@cerebro/cli', 'build'], {
    cwd: resolve(__dirname, '../../..')
  })
})

async function cli<T>(home: string, ...args: string[]): Promise<T> {
  const { stdout } = await execFileAsync(process.execPath, ['--no-warnings', cliPath, ...args], {
    env: { ...process.env, CEREBRO_HOME: home, CEREBRO_WORKSPACE_ID: '' }
  })
  return JSON.parse(stdout) as T
}

async function initGitRepo(dir: string, branch: string, marker: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await execFileAsync('git', ['init', '-b', branch], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'e2e@cerebro.local'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Cerebro E2E'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), `${marker}\n`)
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', `init ${marker}`], { cwd: dir })
}

async function addDirectoryViaUi(
  page: Page,
  electronApp: ElectronApplication,
  directory: string
): Promise<void> {
  await electronApp.evaluate(async ({ dialog }, dir: string) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, directory)
  await page.getByRole('button', { name: 'Add project' }).first().click()
  await page.getByTestId('add-project-choose-folder').click()
}

async function expandProject(page: Page, projectId: number): Promise<void> {
  const row = page.getByTestId(`project-row-${projectId}`)
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
}

async function openStatusSubmenu(
  page: Page,
  row: Locator,
  menuTestId: string,
  workspaceId: number
): Promise<void> {
  await row.hover()
  await page.getByTestId(menuTestId).click()
  const trigger = page.getByTestId(`workspace-move-status-menu-${workspaceId}`)
  await expect(trigger).toBeVisible()
  await trigger.hover()
  const option = page.getByTestId(`workspace-status-option-${workspaceId}-todo`)
  try {
    await expect(option).toBeVisible({ timeout: 1_000 })
  } catch {
    await trigger.focus()
    await page.keyboard.press('ArrowRight')
    await expect(option).toBeVisible()
  }
}

test('marks workspace rows and groups the sidebar by project or status', async ({
  page,
  electronApp
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-workspace-status-'))
  const source = join(sourcesRoot, 'design-tools')
  const notesDir = join(sourcesRoot, 'notes')
  const ledgerDir = join(sourcesRoot, 'ledger')
  try {
    await initGitRepo(join(source, 'storefront'), 'main', 'storefront')
    await initGitRepo(join(source, 'api'), 'main', 'api')
    await initGitRepo(notesDir, 'main', 'notes')
    await initGitRepo(ledgerDir, 'main', 'ledger')
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(760, 900)
    })
    await addDirectoryViaUi(page, electronApp, source)
    await expect(page.getByTestId(/project-row-/).filter({ hasText: 'design-tools' })).toBeVisible({
      timeout: 30_000
    })
    await addDirectoryViaUi(page, electronApp, notesDir)
    await expect(page.getByTestId(/project-row-/).filter({ hasText: 'notes' })).toBeVisible({
      timeout: 30_000
    })
    await addDirectoryViaUi(page, electronApp, ledgerDir)
    await expect(page.getByTestId(/project-row-/).filter({ hasText: 'ledger' })).toBeVisible({
      timeout: 30_000
    })

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'design-tools')
    const notes = listed.projects.find((item) => item.name === 'notes')
    const ledger = listed.projects.find((item) => item.name === 'ledger')
    expect(project && notes && ledger).toBeTruthy()
    const root = project!.workspaces.find((workspace) => workspace.kind === 'root')
    const storefront = project!.workspaces.find(
      (workspace) => basename(workspace.localPath) === 'storefront'
    )
    const api = project!.workspaces.find((workspace) => basename(workspace.localPath) === 'api')
    const notesWorkspace = notes!.workspaces[0]
    const ledgerWorkspace = ledger!.workspaces[0]
    expect(root && storefront && api && notesWorkspace && ledgerWorkspace).toBeTruthy()
    for (const workspace of [
      root,
      storefront,
      api,
      notesWorkspace,
      ledgerWorkspace
    ] as Workspace[]) {
      expect(workspace.status).toBe('todo')
    }

    await expandProject(page, project!.id)
    await expandProject(page, notes!.id)
    await expandProject(page, ledger!.id)

    const rootRow = page.getByTestId(`project-root-${project!.id}`)
    const notesRow = page.getByTestId(`workspace-row-${notesWorkspace!.id}`)
    const ledgerRow = page.getByTestId(`workspace-row-${ledgerWorkspace!.id}`)
    const storefrontRow = page.getByTestId(`workspace-row-${storefront!.id}`)
    const apiRow = page.getByTestId(`workspace-row-${api!.id}`)
    for (const row of [rootRow, notesRow, ledgerRow]) {
      await expect(row).toHaveAttribute('data-workspace-status', 'todo')
      await expect(row.locator('[data-workspace-status-icon]')).toHaveCount(0)
    }
    for (const row of [storefrontRow, apiRow]) {
      await expect(row).not.toHaveAttribute('data-workspace-status')
      await expect(row.locator('[data-workspace-status-icon]')).toHaveCount(0)
    }

    await storefrontRow.hover()
    await page.getByTestId(`workspace-menu-${storefront!.id}`).click()
    await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Move to status' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await notesRow.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Move to status' })).toHaveCount(0)

    await openStatusSubmenu(
      page,
      notesRow,
      `workspace-menu-${notesWorkspace!.id}`,
      notesWorkspace!.id
    )
    const inProgress = page.getByTestId(`workspace-status-option-${notesWorkspace!.id}-in_progress`)
    await inProgress.hover()
    const sidebarBox = await page.locator('[data-slot="sidebar"]').boundingBox()
    const submenuBox = await page.locator('[data-slot="dropdown-menu-sub-content"]').boundingBox()
    expect(sidebarBox && submenuBox).toBeTruthy()
    await page.screenshot({
      path: join(artifacts, 'overflow-status-menu.png'),
      animations: 'disabled',
      clip: {
        x: 0,
        y: 0,
        width: Math.ceil(Math.max(sidebarBox!.width, submenuBox!.x + submenuBox!.width) + 16),
        height: Math.ceil(Math.max(sidebarBox!.height, submenuBox!.y + submenuBox!.height) + 16)
      }
    })
    await inProgress.click()
    await expect(notesRow).toHaveAttribute('data-workspace-status', 'in_progress')
    await expect(notesRow.locator('[data-workspace-status-icon="in_progress"]')).toBeVisible()

    await openStatusSubmenu(page, rootRow, `root-menu-${project!.id}`, root!.id)
    await page.getByTestId(`workspace-status-option-${root!.id}-done`).click()
    await expect(rootRow).toHaveAttribute('data-workspace-status', 'done')

    const home = await electronApp.evaluate(() => process.env.CEREBRO_HOME!)
    const reviewed = await cli<Workspace>(
      home,
      'workspace',
      'status',
      String(ledgerWorkspace!.id),
      'ready-to-review'
    )
    expect(reviewed.status).toBe('ready_to_review')
    const nested = await cli<Workspace>(home, 'workspace', 'status', String(api!.id), 'in-progress')
    expect(nested.status).toBe('in_progress')
    await expect(ledgerRow).toHaveAttribute('data-workspace-status', 'ready_to_review', {
      timeout: 15_000
    })
    await expect(apiRow).not.toHaveAttribute('data-workspace-status')
    await expect(storefrontRow).not.toHaveAttribute('data-workspace-status')

    await page.mouse.move(700, 20)
    await page.locator('[data-slot="sidebar"]').screenshot({
      path: join(artifacts, 'status-projects-current.png'),
      animations: 'disabled'
    })

    await page.getByTestId('sidebar-group-status').click()
    await expect(page.getByTestId('sidebar-group-by')).toHaveAttribute('data-group-by', 'status')
    await expect(page.getByTestId(/project-row-/)).toHaveCount(0)
    await expect(page.getByTestId('status-count-todo')).toHaveText('0')
    await expect(page.getByTestId('status-count-in_progress')).toHaveText('1')
    await expect(page.getByTestId('status-count-ready_to_review')).toHaveText('1')
    await expect(page.getByTestId('status-count-done')).toHaveText('1')

    const group = (status: string): Locator =>
      page.locator('[data-sidebar="menu-item"]').filter({
        has: page.getByTestId(`status-group-${status}`)
      })
    for (const status of ['ready_to_review', 'done']) {
      const header = page.getByTestId(`status-group-${status}`)
      if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
    }
    await expect(
      group('in_progress').getByTestId(`status-project-in_progress-${notes!.id}`)
    ).toBeVisible()
    await expect(
      group('in_progress').getByTestId(`workspace-row-${notesWorkspace!.id}`)
    ).toBeVisible()
    await expect(group('in_progress').getByTestId(`workspace-row-${api!.id}`)).toHaveCount(0)
    await expect(
      group('ready_to_review').getByTestId(`status-project-ready_to_review-${ledger!.id}`)
    ).toBeVisible()
    await expect(
      group('ready_to_review').getByTestId(`workspace-row-${ledgerWorkspace!.id}`)
    ).toBeVisible()
    await expect(group('done').getByTestId(`status-project-done-${project!.id}`)).toBeVisible()
    await expect(group('done').getByTestId(`workspace-row-${root!.id}`)).toBeVisible()
    await expect(group('done').getByText('root')).toBeVisible()
    await expect(group('done').getByTestId(`workspace-row-${storefront!.id}`)).toHaveCount(0)
    await expect(group('todo').getByTestId(/workspace-row-/)).toHaveCount(0)

    await page.mouse.move(700, 20)
    await page.locator('[data-slot="sidebar"]').screenshot({
      path: join(artifacts, 'status-groups-current.png'),
      animations: 'disabled'
    })

    const settings = await page.evaluate(async () => window.cerebro.getSettings())
    expect(settings.sidebarGroupBy).toBe('status')
    await page.reload()
    await expect(page.getByTestId('sidebar-group-status')).toHaveAttribute('data-active', 'true', {
      timeout: 30_000
    })
    await expect(page.getByTestId('status-count-in_progress')).toHaveText('1')
    await expect(page.getByTestId('status-count-done')).toHaveText('1')

    await page.getByTestId('sidebar-group-project').click()
    await expandProject(page, project!.id)
    await expandProject(page, notes!.id)
    await expect(notesRow).toHaveAttribute('data-workspace-status', 'in_progress')
    await expect(rootRow).toHaveAttribute('data-workspace-status', 'done')
    await expect(apiRow).not.toHaveAttribute('data-workspace-status')
    await expect(
      page.evaluate(async () => (await window.cerebro.getSettings()).sidebarGroupBy)
    ).resolves.toBe('project')

    let rejected = false
    try {
      await cli(home, 'workspace', 'status', String(api!.id), 'nope')
    } catch (error) {
      rejected = true
      const stderr = (error as { stderr?: string }).stderr ?? ''
      expect(JSON.parse(stderr).code).toBe('usage')
    }
    expect(rejected).toBe(true)
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})
