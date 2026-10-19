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
    await addDirectoryViaUi(page, electronApp, join(source, 'client'))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await addDirectoryViaUi(page, electronApp, join(source, 'server'))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const sidebar = page.locator('[data-slot="sidebar"]')
    const projectRow = sidebar.getByTestId(/project-row-/).filter({ hasText: 'client' })
    await expect(projectRow).toBeVisible()
    if ((await projectRow.getAttribute('aria-expanded')) !== 'true') await projectRow.click()
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
    await expect(page.getByTestId('content-tab-bar')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

    await search.fill('client')
    await expect(results).toHaveCount(1)
    await expect(sidebar.getByRole('status')).toHaveText('1 workspace found')
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
    // The chevron takes the leading icon's slot on hover instead of sitting on the right.
    await expect(projectRow.locator('[data-row-toggle-chevron]')).toHaveCSS('opacity', '1')
    await expect(projectRow.locator('[data-row-toggle-icon]')).toHaveCSS('opacity', '0')

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
}, testInfo) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-sidebar-style-e2e-'))
  try {
    const source = join(sourcesRoot, 'cerebro')
    const notes = join(sourcesRoot, 'notes')
    await initGitRepo(source, 'feature/sidebar-refinements', 'cerebro')
    await mkdir(notes, { recursive: true })
    await addDirectoryViaUi(page, electronApp, notes)
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'notes' })).toHaveAttribute(
      'data-workspace-role',
      'directory'
    )
    await addDirectoryViaUi(page, electronApp, source)
    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'cerebro' })
    await expect(projectRow).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(projectRow).toHaveAttribute('aria-expanded', 'false')
    await projectRow.focus()
    await expect(projectRow).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(projectRow).toHaveAttribute('aria-expanded', 'true')

    const repoRow = page
      .getByTestId(/workspace-row-/)
      .filter({ hasText: 'feature/sidebar-refinements' })
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
    const projectBox = await projectRow.boundingBox()
    const branchBox = await repoRow.boundingBox()
    expect(projectBox).toBeTruthy()
    expect(branchBox).toBeTruthy()
    expect(Math.abs(branchBox!.x - projectBox!.x)).toBeLessThanOrEqual(2)

    for (const subtree of await sidebar.locator('[data-sidebar="menu-sub"]').all()) {
      await expect(subtree).toHaveCSS('margin-left', '0px')
      await expect(subtree).toHaveCSS('padding-left', '0px')
    }

    await repoRow.click()
    await expect(repoRow).toHaveAttribute('data-active', 'true')
    await expect(repoRow).toHaveCSS('box-shadow', /0px 0px 0px 1px inset/)
    await sidebar.screenshot({
      path: testInfo.outputPath('workspace-row-selected.png'),
      animations: 'disabled'
    })

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

test('renames workspace rows from the menu and can reset to the default label', async ({
  page,
  electronApp
}, testInfo) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-rename-workspace-'))
  const alpha = join(sourcesRoot, 'alpha')
  const notes = join(sourcesRoot, 'notes')

  try {
    await initGitRepo(alpha, 'main', 'alpha')
    await mkdir(notes, { recursive: true })
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1400, 900)
    })
    await addDirectoryViaUi(page, electronApp, alpha)
    await expect(page.getByTestId(/project-row-/).filter({ hasText: 'alpha' })).toBeVisible({
      timeout: 30_000
    })
    await addDirectoryViaUi(page, electronApp, notes)
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const alphaProject = listed.projects.find((item) => item.name === 'alpha')
    const notesProject = listed.projects.find((item) => item.name === 'notes')
    const branchWorkspace = alphaProject?.workspaces[0]
    const notesWorkspace = notesProject?.workspaces[0]
    expect(branchWorkspace?.id).toBeTruthy()
    expect(notesWorkspace?.id).toBeTruthy()
    expect(notesWorkspace?.branch).toBe('')

    await expandProject(page, 'alpha')
    const branchRow = page.getByTestId(`workspace-row-${branchWorkspace!.id}`)
    await expect(branchRow).toContainText('main')
    await branchRow.scrollIntoViewIfNeeded()
    await branchRow.hover()
    await page.getByTestId(`workspace-menu-${branchWorkspace!.id}`).click()
    await page.getByTestId(`workspace-rename-${branchWorkspace!.id}`).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Rename workspace' })).toBeVisible()
    const input = page.getByTestId('workspace-rename-input')
    await expect(input).toHaveValue('main')
    await expect(page.getByTestId('workspace-rename-default')).toHaveText('Default: main')
    await expect(page.getByTestId('workspace-rename-reset')).toBeVisible()
    await input.fill('')
    await page.getByTestId('workspace-rename-submit').click()
    await expect(page.getByTestId('workspace-rename-error')).toHaveText('Enter a name.')
    await input.fill('Alpha checkout')
    await page.screenshot({
      path: testInfo.outputPath('workspace-rename-dialog.png'),
      animations: 'disabled'
    })
    await page.getByTestId('workspace-rename-submit').click()
    await expect(dialog).toHaveCount(0)
    await expect(branchRow).toContainText('Alpha checkout')
    await expect
      .poll(async () => {
        const next = await page.evaluate(async () => window.cerebro.listProjects())
        return next.projects
          .flatMap((project) => project.workspaces)
          .find((workspace) => workspace.id === branchWorkspace!.id)?.displayName
      })
      .toBe('Alpha checkout')
    await page.screenshot({
      path: testInfo.outputPath('workspace-rename-named.png'),
      animations: 'disabled'
    })

    await branchRow.hover()
    await page.getByTestId(`workspace-menu-${branchWorkspace!.id}`).click()
    await page.getByTestId(`workspace-rename-${branchWorkspace!.id}`).click()
    await expect(input).toHaveValue('Alpha checkout')
    await page.screenshot({
      path: testInfo.outputPath('workspace-rename-reset.png'),
      animations: 'disabled'
    })
    await page.getByTestId('workspace-rename-reset').click()
    await expect(dialog).toHaveCount(0)
    await expect(branchRow).toContainText('main')
    await expect(branchRow).not.toContainText('Alpha checkout')

    const notesRow = page.getByTestId(`workspace-row-${notesWorkspace!.id}`)
    await expect(notesRow).toHaveAttribute('data-workspace-role', 'directory')
    await notesRow.scrollIntoViewIfNeeded()
    await notesRow.hover()
    await page.getByTestId(`workspace-menu-${notesWorkspace!.id}`).click()
    await page.getByTestId(`workspace-rename-${notesWorkspace!.id}`).click()
    await expect(input).toHaveValue('notes')
    await expect(page.getByTestId('workspace-rename-default')).toHaveText('Default: notes')
    await input.fill('Scratch')
    await page.getByTestId('workspace-rename-submit').click()
    await expect(dialog).toHaveCount(0)
    await expect(notesRow).toContainText('Scratch')
    await page.screenshot({
      path: testInfo.outputPath('workspace-rename-directory.png'),
      animations: 'disabled'
    })

    await notesRow.hover()
    await page.getByTestId(`workspace-menu-${notesWorkspace!.id}`).click()
    await page.getByTestId(`workspace-rename-${notesWorkspace!.id}`).click()
    await page.getByTestId('workspace-rename-reset').click()
    await expect(notesRow).toContainText('notes')
    await expect(notesRow).not.toContainText('Scratch')
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

async function expandProject(page: Page, name: string): Promise<void> {
  const row = page.getByTestId(/project-row-/).filter({ hasText: name })
  await expect(row).toBeVisible()
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
}
