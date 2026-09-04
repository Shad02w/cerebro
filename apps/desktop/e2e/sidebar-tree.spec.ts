import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

test('shows the more action only on the hovered sidebar tree row', async ({ page, electronApp }) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-sidebar-tree-e2e-'))
  const source = join(sourcesRoot, 'tree-alpha')

  try {
    await initGitRepo(source, 'main', 'tree-alpha')
    await addDirectoryViaUi(page, electronApp, source)

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'tree-alpha' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'tree-alpha')
    const workspace = project?.workspaces[0]
    expect(project?.id).toBeTruthy()
    expect(workspace?.id).toBeTruthy()

    const sidebar = page.locator('[data-slot="sidebar"]')
    const childRow = sidebar.getByTestId(`workspace-row-${workspace!.id}`)
    const parentMore = sidebar.getByTestId(`project-menu-${project!.id}`)
    const childMore = sidebar.getByTestId(`workspace-menu-${workspace!.id}`)

    await expect(childRow).toBeVisible()
    await expect(parentMore).toHaveCSS('opacity', '0')
    await expect(childMore).toHaveCSS('opacity', '0')

    await projectRow.hover()
    await expect(parentMore).toHaveCSS('opacity', '1')
    await expect(childMore).toHaveCSS('opacity', '0')

    await childRow.hover()
    await expect(childMore).toHaveCSS('opacity', '1')
    await expect(parentMore).toHaveCSS('opacity', '0')
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})
