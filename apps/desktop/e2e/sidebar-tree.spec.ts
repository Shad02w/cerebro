import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test, type ElectronApplication, type Page } from './fixtures'
import { ensureArtifactDir } from './artifact-dir'

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
    await expect(page.getByTestId('content-tab-bar')).toBeVisible()
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

    const cerebroProject = sidebar.getByTestId(/project-row-/).filter({ hasText: 'cerebro' })
    const branchRow = sidebar
      .getByTestId(/workspace-row-/)
      .filter({ hasText: 'feature/sidebar-refinements' })
    const projectBox = await cerebroProject.boundingBox()
    const branchBox = await branchRow.boundingBox()
    expect(projectBox).toBeTruthy()
    expect(branchBox).toBeTruthy()
    expect(Math.abs(projectBox!.x - branchBox!.x)).toBeLessThanOrEqual(1)

    for (const subtree of await sidebar.locator('[data-sidebar="menu-sub"]').all()) {
      await expect(subtree).toHaveCSS('margin-left', '0px')
      await expect(subtree).toHaveCSS('padding-left', '0px')
    }
    const repoTree = sidebar.getByTestId(/project-repo-tree-/)
    await expect(repoTree).toHaveCSS('margin-left', '24px')
    const rootButton = sidebar.locator('[data-workspace-role="root"]')
    const rootBox = await rootButton.boundingBox()
    const repoBox = await repoRow.boundingBox()
    expect(rootBox).toBeTruthy()
    expect(repoBox).toBeTruthy()
    expect(repoBox!.x - rootBox!.x).toBeGreaterThanOrEqual(20)
    expect(repoBox!.x - rootBox!.x).toBeLessThanOrEqual(28)

    // Hovering root (while another workspace is selected) paints the whole block.
    await branchRow.click()
    await expect(branchRow).toHaveAttribute('data-active', 'true')
    await expect(rootGroup).toHaveAttribute('data-active', 'false')
    await expect(rootGroup).toHaveAttribute('data-hover', 'false')
    await expect(rootGroup).not.toHaveCSS('box-shadow', /0px 0px 0px 1px inset/)
    await rootButton.hover()
    await expect(rootGroup).toHaveAttribute('data-hover', 'true')
    await expect(rootGroup).toHaveCSS('box-shadow', /0px 0px 0px 1px inset/)
    await expect(rootButton).toHaveCSS('box-shadow', 'none')
    await expect(rootButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    for (const row of await rootGroup.locator('[data-workspace-role="repository"]').all()) {
      await expect(row).toHaveAttribute('data-active', 'false')
      await expect(row).toHaveCSS('box-shadow', 'none')
    }
    const artifacts = await ensureArtifactDir('/opt/cursor/artifacts')
    const sidebarBox = await sidebar.boundingBox()
    expect(sidebarBox).toBeTruthy()
    await page.screenshot({
      path: join(artifacts, 'multi-root-hover-block.png'),
      animations: 'disabled',
      clip: sidebarBox!
    })
    await expect(rootGroup).toHaveAttribute('data-hover', 'true')

    // Hovering a nested repo only highlights that row, not the whole block.
    await repoRow.hover()
    await expect(rootGroup).toHaveAttribute('data-hover', 'false')
    await expect(rootGroup).not.toHaveCSS('box-shadow', /0px 0px 0px 1px inset/)
    const nestedSidebarBox = await sidebar.boundingBox()
    expect(nestedSidebarBox).toBeTruthy()
    await page.screenshot({
      path: join(artifacts, 'multi-root-hover-nested.png'),
      animations: 'disabled',
      clip: nestedSidebarBox!
    })

    await rootButton.click()
    await expect(rootButton).toHaveAttribute('data-active', 'true')
    await expect(rootGroup).toHaveAttribute('data-active', 'true')
    await expect(rootGroup).toHaveCSS('box-shadow', /0px 0px 0px 1px inset/)
    await expect(rootButton).toHaveCSS('box-shadow', 'none')
    const groupBox = await rootGroup.boundingBox()
    expect(groupBox).toBeTruthy()
    expect(groupBox!.height).toBeGreaterThan(rootBox!.height + 40)
    for (const row of await rootGroup.locator('[data-workspace-role="repository"]').all()) {
      await expect(row).toHaveAttribute('data-active', 'false')
      await expect(row).toHaveCSS('box-shadow', 'none')
    }
    await sidebar.screenshot({
      path: join(artifacts, 'multi-root-block-selected.png'),
      animations: 'disabled'
    })

    await repoRow.click()
    await expect(repoRow).toHaveAttribute('data-active', 'true')
    await expect(repoRow).toHaveCSS('box-shadow', /0px 0px 0px 1px inset/)
    await expect(rootGroup).toHaveAttribute('data-active', 'false')
    await expect(rootButton).toHaveAttribute('data-active', 'false')
    await expect(rootGroup).not.toHaveCSS('box-shadow', /0px 0px 0px 1px inset/)
    await sidebar.screenshot({
      path: join(artifacts, 'multi-root-repo-selected.png'),
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
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-rename-workspace-'))
  const alpha = join(sourcesRoot, 'alpha')
  const suite = join(sourcesRoot, 'suite')
  const artifacts = await ensureArtifactDir('/opt/cursor/artifacts')

  try {
    await initGitRepo(alpha, 'main', 'alpha')
    await initGitRepo(join(suite, 'frontend'), 'main', 'frontend')
    await initGitRepo(join(suite, 'backend'), 'develop', 'backend')
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1400, 900)
    })
    await addDirectoryViaUi(page, electronApp, alpha)
    await expect(page.getByTestId(/project-row-/).filter({ hasText: 'alpha' })).toBeVisible({
      timeout: 30_000
    })
    await addDirectoryViaUi(page, electronApp, suite)
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const alphaProject = listed.projects.find((item) => item.name === 'alpha')
    const suiteProject = listed.projects.find((item) => item.name === 'suite')
    const branchWorkspace = alphaProject?.workspaces[0]
    const frontend = suiteProject?.workspaces.find((workspace) =>
      workspace.localPath.endsWith('/frontend')
    )
    const rootWorkspace = suiteProject?.workspaces.find((workspace) => workspace.kind === 'root')
    expect(branchWorkspace?.id).toBeTruthy()
    expect(frontend?.id).toBeTruthy()
    expect(rootWorkspace?.id).toBeTruthy()

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
      path: join(artifacts, 'workspace-rename-dialog.png'),
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
      path: join(artifacts, 'workspace-rename-named.png'),
      animations: 'disabled'
    })

    await branchRow.hover()
    await page.getByTestId(`workspace-menu-${branchWorkspace!.id}`).click()
    await page.getByTestId(`workspace-rename-${branchWorkspace!.id}`).click()
    await expect(input).toHaveValue('Alpha checkout')
    await page.screenshot({
      path: join(artifacts, 'workspace-rename-reset.png'),
      animations: 'disabled'
    })
    await page.getByTestId('workspace-rename-reset').click()
    await expect(dialog).toHaveCount(0)
    await expect(branchRow).toContainText('main')
    await expect(branchRow).not.toContainText('Alpha checkout')

    await expandProject(page, 'suite')
    const repoName = page.getByTestId(`workspace-repo-${frontend!.id}`)
    await expect(repoName).toHaveText('frontend')
    const repoRow = page.getByTestId(`workspace-row-${frontend!.id}`)
    await repoRow.scrollIntoViewIfNeeded()
    await repoRow.hover()
    await page.getByTestId(`workspace-menu-${frontend!.id}`).click()
    await page.getByTestId(`workspace-rename-${frontend!.id}`).click()
    await expect(input).toHaveValue('frontend')
    await expect(page.getByTestId('workspace-rename-default')).toHaveText('Default: frontend')
    await input.fill('Web client')
    await page.getByTestId('workspace-rename-submit').click()
    await expect(dialog).toHaveCount(0)
    await expect(repoName).toHaveText('Web client')
    await expect(page.getByTestId(`workspace-branch-${frontend!.id}`)).toContainText('main')
    await page.screenshot({
      path: join(artifacts, 'workspace-rename-directory.png'),
      animations: 'disabled'
    })

    await repoRow.hover()
    await page.getByTestId(`workspace-menu-${frontend!.id}`).click()
    await page.getByTestId(`workspace-rename-${frontend!.id}`).click()
    await page.getByTestId('workspace-rename-reset').click()
    await expect(repoName).toHaveText('frontend')

    const rootButton = page.getByTestId(`project-root-${suiteProject!.id}`)
    await expect(rootButton).toContainText('root')
    await rootButton.scrollIntoViewIfNeeded()
    await rootButton.hover()
    await page.getByTestId(`root-menu-${suiteProject!.id}`).click()
    await page.getByTestId(`workspace-rename-${rootWorkspace!.id}`).click()
    await expect(input).toHaveValue('root')
    await input.fill('Suite root')
    await page.getByTestId('workspace-rename-submit').click()
    await expect(rootButton).toContainText('Suite root')
    await rootButton.hover()
    await page.getByTestId(`root-menu-${suiteProject!.id}`).click()
    await page.getByTestId(`workspace-rename-${rootWorkspace!.id}`).click()
    await page.getByTestId('workspace-rename-reset').click()
    await expect(rootButton).toContainText('root')
    await expect(rootButton).not.toContainText('Suite root')
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
