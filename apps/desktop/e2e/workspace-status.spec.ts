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

test('marks workspace rows and groups the sidebar by project or status', async ({
  page,
  electronApp
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-workspace-status-'))
  const source = join(sourcesRoot, 'design-tools')
  try {
    await initGitRepo(join(source, 'storefront'), 'main', 'storefront')
    await initGitRepo(join(source, 'api'), 'main', 'api')
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1280, 860)
    })
    await addDirectoryViaUi(page, electronApp, source)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'design-tools' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })
    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'design-tools')
    expect(project).toBeTruthy()
    const workspaces = project!.workspaces
    const root = workspaces.find((workspace) => workspace.kind === 'root')
    const storefront = workspaces.find(
      (workspace) => basename(workspace.localPath) === 'storefront'
    )
    const api = workspaces.find((workspace) => basename(workspace.localPath) === 'api')
    expect(root && storefront && api).toBeTruthy()
    for (const workspace of [root, storefront, api] as Workspace[]) {
      expect(workspace.status).toBe('todo')
      const row =
        workspace.kind === 'root'
          ? page.getByTestId(`project-root-${project!.id}`)
          : page.getByTestId(`workspace-row-${workspace.id}`)
      await expect(row).toHaveAttribute('data-workspace-status', 'todo')
      await expect(row.locator('[data-workspace-status-icon="todo"]')).toBeVisible()
    }

    const storefrontRow = page.getByTestId(`workspace-row-${storefront!.id}`)
    await storefrontRow.hover()
    await page.getByTestId(`workspace-menu-${storefront!.id}`).click()
    await expect(page.getByTestId(`workspace-status-option-${storefront!.id}-todo`)).toBeVisible()
    await page.screenshot({
      path: join(artifacts, 'workspace-status-menu.png'),
      animations: 'disabled'
    })
    await page.getByTestId(`workspace-status-option-${storefront!.id}-in_progress`).click()
    await expect(storefrontRow).toHaveAttribute('data-workspace-status', 'in_progress')
    await expect(storefrontRow.locator('[data-workspace-status-icon="in_progress"]')).toBeVisible()

    const home = await electronApp.evaluate(() => process.env.CEREBRO_HOME!)
    const current = await cli<Workspace>(home, 'workspace', 'status', String(storefront!.id))
    expect(current.status).toBe('in_progress')
    const reviewed = await cli<Workspace>(
      home,
      'workspace',
      'status',
      String(api!.id),
      'ready-to-review'
    )
    expect(reviewed.status).toBe('ready_to_review')
    const finished = await cli<Workspace>(home, 'workspace', 'status', String(root!.id), 'done')
    expect(finished.status).toBe('done')
    await expect(page.getByTestId(`workspace-row-${api!.id}`)).toHaveAttribute(
      'data-workspace-status',
      'ready_to_review',
      { timeout: 15_000 }
    )
    await expect(page.getByTestId(`project-root-${project!.id}`)).toHaveAttribute(
      'data-workspace-status',
      'done'
    )

    await page.screenshot({
      path: join(artifacts, 'workspace-status-by-project.png'),
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
    const doneGroup = page.getByTestId('status-group-done')
    if ((await doneGroup.getAttribute('aria-expanded')) !== 'true') await doneGroup.click()
    await expect(group('in_progress').getByTestId(`workspace-row-${storefront!.id}`)).toBeVisible()
    await expect(group('ready_to_review').getByTestId(`workspace-row-${api!.id}`)).toBeVisible()
    await expect(group('done').getByTestId(`workspace-row-${root!.id}`)).toBeVisible()
    await expect(group('todo').getByTestId(/workspace-row-/)).toHaveCount(0)
    await expect(group('in_progress').getByText('design-tools')).toBeVisible()

    await page.screenshot({
      path: join(artifacts, 'workspace-status-by-status.png'),
      animations: 'disabled'
    })

    const settings = await page.evaluate(async () => window.cerebro.getSettings())
    expect(settings.sidebarGroupBy).toBe('status')
    await page.reload()
    await expect(page.getByTestId('sidebar-group-status')).toHaveAttribute('data-active', 'true', {
      timeout: 30_000
    })
    await expect(page.getByTestId('status-count-in_progress')).toHaveText('1')

    await page.getByTestId('sidebar-group-project').click()
    await expect(page.getByTestId(`workspace-row-${storefront!.id}`)).toHaveAttribute(
      'data-workspace-status',
      'in_progress'
    )
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
