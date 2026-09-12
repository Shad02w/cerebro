import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test, type ElectronApplication, type Page } from './fixtures'

const execFileAsync = promisify(execFile)

test('header searches projects, repositories and branches without changing tree state', async ({
  page,
  electronApp
}) => {
  const source = await mkdtemp(join(tmpdir(), 'cerebro-header-search-'))
  try {
    await initGitRepo(join(source, 'client'), 'feature/sidebar-search', 'client')
    await initGitRepo(join(source, 'server'), 'main', 'server')
    await addDirectoryViaUi(page, electronApp, source)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const sidebar = page.locator('[data-slot="sidebar"]')
    const projectRow = sidebar.getByTestId(/project-row-/)
    await expect(projectRow).toHaveAttribute('aria-expanded', 'true')
    await projectRow.click()
    await expect(projectRow).toHaveAttribute('aria-expanded', 'false')

    const search = page.getByRole('textbox', { name: 'Search projects and workspaces' })
    const results = sidebar.getByTestId(/workspace-search-result-/)
    await search.fill('CLIENT')
    await expect(results).toHaveCount(1)
    await expect(results).toContainText('feature/sidebar-search')
    await search.fill('SIDEBAR-SEARCH')
    await expect(results).toHaveCount(1)
    await search.press('Enter')
    await expect(results).toHaveAttribute('aria-current', 'location')
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

    await search.fill(source.split('/').at(-1)!)
    await expect(results).toHaveCount(3)
    await expect(sidebar.getByRole('status')).toHaveText('3 workspaces found')
    await search.fill('no-such-workspace')
    await expect(results).toHaveCount(0)
    await expect(sidebar.getByRole('status')).toHaveText('No matching workspaces')
    const selected = await page.evaluate(
      async () => (await window.cerebro.listProjects()).activeWorkspaceId
    )
    await search.press('Enter')
    expect(
      await page.evaluate(async () => (await window.cerebro.listProjects()).activeWorkspaceId)
    ).toBe(selected)

    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('')
    await expect(projectRow).toBeVisible()
    await expect(projectRow).toHaveAttribute('aria-expanded', 'false')
    await search.fill('server')
    await expect(results).toHaveCount(1)
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(projectRow).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await rm(source, { recursive: true, force: true })
  }
})

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

test('shows the more action only on the hovered sidebar tree row', async ({
  page,
  electronApp
}) => {
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
    await expect(projectRow.locator('.lucide-chevron-right')).toHaveCount(0)

    await childRow.hover()
    await expect(childMore).toHaveCSS('opacity', '1')
    await expect(parentMore).toHaveCSS('opacity', '0')

    // Small icon controls keep distinct straight edges even while hovered.
    for (const button of [
      parentMore,
      childMore,
      sidebar.getByRole('button', { name: 'Add project' }),
      page.getByRole('button', { name: 'Toggle Sidebar' })
    ]) {
      await button.hover()
      await expect(button).toHaveCSS('border-radius', '4px')
      await expect(button).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      const box = await button.boundingBox()
      expect(box).toBeTruthy()
      expect(box!.width).toBe(box!.height)
    }
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

test('sidebar keeps keyboard selection and disclosures usable in both themes', async ({
  page,
  electronApp
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-sidebar-style-e2e-'))
  try {
    const source = join(sourcesRoot, 'cerebro')
    const collection = join(sourcesRoot, 'design-tools')
    await initGitRepo(source, 'feature/sidebar-refinements', 'cerebro')
    await initGitRepo(join(collection, 'component-library'), 'main', 'components')
    await initGitRepo(join(collection, 'desktop-client'), 'develop', 'desktop')
    await initGitRepo(join(collection, 'react-aria'), 'main', 'react-aria')
    await initGitRepo(join(collection, 'tmux'), 'master', 'tmux')
    await addDirectoryViaUi(page, electronApp, source)
    await expect(page.getByTestId(/project-row-/).filter({ hasText: 'cerebro' })).toBeVisible()
    await addDirectoryViaUi(page, electronApp, collection)
    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'design-tools' })
    await expect(projectRow).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await projectRow.focus()
    await expect(projectRow).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(projectRow).toHaveAttribute('aria-expanded', 'true')

    const repoRow = page.getByTestId(/workspace-row-/).filter({ hasText: 'component-library' })
    await expect(repoRow).toBeVisible()
    await repoRow.focus()
    await expect(repoRow).toBeFocused()
    await expect(repoRow).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Enter')
    await expect(repoRow).toHaveAttribute('aria-current', 'location')
    await expect(repoRow).toHaveAttribute('data-active', 'true')
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

    // Keyboard users can reveal and open the row actions without hovering.
    await page.keyboard.press('Tab')
    const more = repoRow.locator('..').getByTestId(/workspace-menu-/)
    await expect(more).toBeFocused()
    await expect(more).toHaveCSS('opacity', '1')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeVisible()
    await page.keyboard.press('Escape')

    await projectRow.focus()
    await page.keyboard.press('Enter')
    await expect(repoRow).toBeHidden()
    await expect(projectRow).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(repoRow).toHaveAttribute('aria-current', 'location')

    const sidebar = page.locator('[data-slot="sidebar"]')
    const rootGroup = sidebar.getByTestId(/root-group-/)
    await expect(rootGroup.getByTestId(/root-repo-count-/)).toHaveText('4 repos')
    await expect(rootGroup.getByTestId(/workspace-row-/)).toHaveCount(4)
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => {
        document.documentElement.classList.toggle('dark', value === 'dark')
      }, theme)
      await page.mouse.move(600, 400)
      await projectRow.blur()
      for (const subtree of await sidebar.locator('[data-sidebar="menu-sub"]').all()) {
        await expect(subtree).toHaveCSS('border-left-width', '0px')
      }
      await expect(repoRow).toHaveCSS('box-shadow', /0px 0px 0px 1px inset/)
      await sidebar.screenshot({
        path: join(tmpdir(), `cerebro-sidebar-after-${theme}.png`),
        animations: 'disabled'
      })
    }
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})
