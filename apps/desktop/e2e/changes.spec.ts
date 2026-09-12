import type { Locator } from '@playwright/test'
import type { Project } from '../src/shared/types'
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
  await expect(
    page.getByTestId(/project-row-/).filter({ hasText: basename(directory) })
  ).toBeVisible({
    timeout: 30_000
  })
}

async function listedProject(page: Page, name: string): Promise<Project | undefined> {
  const listed = await page.evaluate(async () => window.cerebro.listProjects())
  return listed.projects.find((item) => item.name === name)
}

async function selectDefaultWorkspace(page: Page, projectName: string): Promise<void> {
  const project = await listedProject(page, projectName)
  const workspaceId = project?.workspaces[0]?.id
  expect(workspaceId).toBeTruthy()
  await page.getByTestId(`workspace-row-${workspaceId}`).click()
}

async function openAddTabMenu(page: Page): Promise<void> {
  const menu = page.getByTestId('add-tab-menu')
  if (await menu.isVisible()) return
  await page.getByTestId('new-terminal-tab').click()
  await expect(menu).toBeVisible()
}

async function openChanges(page: Page): Promise<void> {
  await openAddTabMenu(page)
  await page.getByTestId('open-changes-tab').click()
  await expect(page.getByTestId('add-tab-menu')).toHaveCount(0)
  await expect(page.getByTestId('changes-tab')).toBeVisible()
  await expect(activeChanges(page)).toBeVisible()
}

function activeChanges(page: Page): Locator {
  return page.locator('[data-testid="changes-view"][data-active="true"]')
}

function closeChord(): string {
  return process.platform === 'darwin' ? 'Meta+w' : 'Control+w'
}

function openChangesChord(): string {
  return process.platform === 'darwin' ? 'Meta+Shift+g' : 'Control+Shift+g'
}

test('shows working-tree diffs in a Changes tab with a right-hand file list', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-e2e-'))
  const repo = join(root, 'changed-alpha')

  try {
    await initGitRepo(repo, 'main', 'changed-alpha')
    await writeFile(
      join(repo, 'README.md'),
      'changed-alpha\nhello from changes\n' + 'more changes\n'.repeat(100)
    )
    await writeFile(join(repo, 'zzz.ts'), 'export const lastFile = true\n')
    await addDirectoryViaUi(page, electronApp, repo)
    await selectDefaultWorkspace(page, 'changed-alpha')
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()

    await openChanges(page)
    const pane = activeChanges(page)
    const sidebar = pane.getByTestId('changes-sidebar')
    const diff = pane.getByTestId('changes-diff')
    await expect(sidebar).toBeVisible()
    const fileRow = pane.getByRole('treeitem', { name: 'README.md', exact: true })
    await expect(fileRow).toBeVisible({ timeout: 15_000 })
    await expect(fileRow).toHaveAttribute('data-item-path', 'README.md')
    await expect(diff).toContainText('hello from changes', {
      timeout: 15_000
    })
    const diffsHost = diff.locator('diffs-container').first()
    await expect(diffsHost).toBeVisible()
    await expect
      .poll(async () => diffsHost.evaluate((el) => getComputedStyle(el).colorScheme))
      .toMatch(/dark/)
    const backgroundRgb = await diffsHost.evaluate((el) => {
      const raw = getComputedStyle(el).backgroundColor
      const match = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (!match) return raw
      return [Number(match[1]), Number(match[2]), Number(match[3])]
    })
    expect(Array.isArray(backgroundRgb)).toBe(true)
    const [r, g, b] = backgroundRgb as [number, number, number]
    expect(r).toBeLessThan(40)
    expect(g).toBeLessThan(40)
    expect(b).toBeLessThan(40)
    const [diffBox, sidebarBox] = await Promise.all([diff.boundingBox(), sidebar.boundingBox()])
    expect(diffBox).toBeTruthy()
    expect(sidebarBox).toBeTruthy()
    expect(sidebarBox!.x).toBeGreaterThan(diffBox!.x + (diffBox!.width ?? 0) / 2)
    await pane.getByRole('treeitem', { name: 'zzz.ts', exact: true }).click()
    await expect
      .poll(() =>
        diff
          .locator(':scope > div')
          .first()
          .evaluate((el) => el.scrollTop)
      )
      .toBeGreaterThan(100)
    await expect(diff).toContainText('lastFile')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('folds whole file diffs individually and together, and opens a folded file from the tree', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-fold-'))
  const repo = join(root, 'changed-fold')
  try {
    await initGitRepo(repo, 'main', 'changed-fold')
    await writeFile(
      join(repo, 'README.md'),
      'changed-fold\nreview first file\n' + 'long change\n'.repeat(150)
    )
    await writeFile(join(repo, 'zzz.ts'), 'export const reviewLastFile = true\n')
    await addDirectoryViaUi(page, electronApp, repo)
    await selectDefaultWorkspace(page, 'changed-fold')
    await openChanges(page)
    const pane = activeChanges(page)
    const diff = pane.getByTestId('changes-diff')
    const collapseReadme = diff.getByRole('button', { name: 'Collapse README.md', exact: true })
    await expect(collapseReadme).toBeVisible()
    await collapseReadme.click()
    await expect(
      diff.getByRole('button', { name: 'Expand README.md', exact: true })
    ).toHaveAttribute('aria-expanded', 'false')
    await expect(diff).not.toContainText('review first file')
    await expect(diff).toContainText('reviewLastFile')

    await pane.getByRole('button', { name: 'Collapse all diffs', exact: true }).click()
    await expect(diff.getByRole('button', { name: 'Expand zzz.ts', exact: true })).toBeVisible()
    await expect(diff).not.toContainText('reviewLastFile')
    const textHeaders = diff.locator('[data-diffs-header]')
    for (const header of await textHeaders.all()) {
      await expect(header).toHaveCSS('height', '32px')
    }
    const collapsedSpacing = await diff.locator('[data-change-path]').evaluateAll((files) => {
      const first = files[0].getBoundingClientRect()
      const second = files[1].getBoundingClientRect()
      return second.top - first.bottom
    })
    expect(collapsedSpacing).toBe(4)
    await pane.getByTestId('changes-refresh').click()
    await expect(diff.getByRole('button', { name: 'Expand README.md', exact: true })).toBeVisible()
    await expect(diff.getByRole('button', { name: 'Expand zzz.ts', exact: true })).toBeVisible()
    await pane.getByRole('treeitem', { name: 'zzz.ts', exact: true }).click()
    await expect(diff).toContainText('reviewLastFile')
    await expect(
      diff.getByRole('button', { name: 'Collapse zzz.ts', exact: true })
    ).toHaveAttribute('aria-expanded', 'true')
    await expect(diff.getByRole('button', { name: 'Expand README.md', exact: true })).toBeVisible()
    await pane.getByRole('button', { name: 'Expand all diffs', exact: true }).click()
    await pane.getByRole('treeitem', { name: 'README.md', exact: true }).click()
    await expect(diff).toContainText('review first file')
    await pane.getByRole('button', { name: 'Collapse all diffs', exact: true }).click()
    const expand = diff.getByRole('button', { name: 'Expand README.md', exact: true })
    await expand.focus()
    await page.keyboard.press('Enter')
    await expect(diff).toContainText('review first file')
    await pane.getByRole('button', { name: 'Collapse all diffs', exact: true }).click()
    await page.screenshot({ path: '/tmp/cerebro-changes-folding.png' })
    // Keep late files reachable when a review has many expanded, long diffs.
    for (let index = 0; index < 40; index++) {
      await writeFile(
        join(repo, `file-${String(index).padStart(2, '0')}.txt`),
        `file ${index}\n` + 'change\n'.repeat(200)
      )
    }
    await pane.getByTestId('changes-refresh').click()
    await expect(diff.locator('[data-change-path]')).toHaveCount(42)
    await pane.getByRole('button', { name: 'Collapse all diffs', exact: true }).click()
    await page.mouse.move(1000, 700)
    await page.screenshot({ path: '/tmp/cerebro-changes-compact-headers.png' })
    const lastRow = pane.getByRole('treeitem', { name: 'file-39.txt', exact: true })
    await lastRow.scrollIntoViewIfNeeded()
    await lastRow.click()
    const lastFile = diff.locator('[data-change-path="file-39.txt"]')
    await expect(lastFile).toBeInViewport()
    await expect(lastFile).toContainText('file 39')
    await expect(
      diff.getByRole('button', { name: 'Expand file-38.txt', exact: true })
    ).toBeVisible()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scrolls through inline image versions, text diffs, and binary fallbacks', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-images-'))
  const repo = join(root, 'changed-images')
  try {
    await initGitRepo(repo, 'main', 'changed-images')
    const pngs = await electronApp.evaluate(({ nativeImage }) => {
      return [0, 1].map((variant) => {
        const width = 240
        const height = 160
        const bitmap = Buffer.alloc(width * height * 4)
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4
            bitmap[offset] = variant ? 110 : 220
            bitmap[offset + 1] = Math.round((y / height) * 200)
            bitmap[offset + 2] = Math.round((x / width) * 240)
            bitmap[offset + 3] = 255
          }
        }
        return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG().toString('base64')
      })
    })
    const before = Buffer.from(pngs[0], 'base64')
    const after = Buffer.from(pngs[1], 'base64')
    for (const name of ['modified.png', 'deleted.png', 'old.png']) {
      // Distinct contents keep Git's similarity-based rename detection unambiguous.
      await writeFile(join(repo, name), name === 'deleted.png' ? after : before)
    }
    await execFileAsync('git', ['add', '.'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'image baseline'], { cwd: repo })
    await writeFile(join(repo, 'modified.png'), after)
    await rm(join(repo, 'deleted.png'))
    await execFileAsync('git', ['mv', 'old.png', 'renamed.png'], { cwd: repo })
    await writeFile(join(repo, 'a-new.png'), after)
    await writeFile(join(repo, 'broken.png'), 'invalid image')
    await writeFile(join(repo, 'data.bin'), Buffer.from([0, 1, 2]))
    await writeFile(join(repo, 'large.png'), Buffer.alloc(5 * 1024 * 1024 + 1))
    await writeFile(
      join(repo, 'vector.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="teal"/></svg>'
    )
    await writeFile(join(repo, 'README.md'), 'changed-images\ntext still works\n')
    await addDirectoryViaUi(page, electronApp, repo)
    await selectDefaultWorkspace(page, 'changed-images')
    await openChanges(page)
    const pane = activeChanges(page)
    const diff = pane.getByTestId('changes-diff')
    const previewFor = (name: string): Locator =>
      pane
        .getByTestId('changes-file-preview')
        .filter({ has: page.locator(`img[alt$=": ${name}"]`) })
    const block = (name: string): Locator => diff.locator(`[data-change-path="${name}"]`)
    const reveal = async (name: string): Promise<Locator> => {
      const target = block(name)
      await target.scrollIntoViewIfNeeded()
      await expect(target).toBeInViewport()
      return target.getByTestId('changes-file-preview')
    }
    const expectDecoded = async (preview: Locator, count: number): Promise<void> => {
      await expect(preview.getByRole('img')).toHaveCount(count)
      for (const img of await preview.getByRole('img').all()) {
        await expect
          .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
          .toBe(true)
      }
    }
    await expectDecoded(previewFor('a-new.png'), 1)
    // Every image is inline; scrolling never requires changing the selected tree row.
    const initialSelection = pane.getByRole('treeitem', { name: 'a-new.png', exact: true })
    await expect(initialSelection).toHaveAttribute('aria-selected', 'true')
    let preview = await reveal('modified.png')
    await expectDecoded(preview, 2)
    await expect(
      preview.getByRole('img', { name: 'Before (HEAD): modified.png', exact: true })
    ).toHaveAttribute('src', `data:image/png;base64,${pngs[0]}`)
    await expect(
      preview.getByRole('img', { name: 'After (working tree): modified.png', exact: true })
    ).toHaveAttribute('src', `data:image/png;base64,${pngs[1]}`)
    await expect(initialSelection).toHaveAttribute('aria-selected', 'true')
    await block('README.md').scrollIntoViewIfNeeded()
    await expect(block('README.md')).toContainText('text still works')
    await expect(initialSelection).toHaveAttribute('aria-selected', 'true')
    await block('modified.png').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    // Dismiss workspace hover details before capturing the review surface.
    await page.getByRole('button', { name: 'main', exact: true }).press('Escape')
    await page.mouse.move(1040, 780)
    await expect(page.getByText(/Workspace created/)).toBeHidden()
    await page.screenshot({ path: '/tmp/cerebro-changes-image-preview.png' })
    await writeFile(join(repo, 'modified.png'), before)
    await writeFile(join(repo, 'a-new.png'), before)
    await pane.getByTestId('changes-refresh').click()
    await expect(block('modified.png')).toHaveCount(0)
    await expect(previewFor('a-new.png').getByRole('img')).toHaveAttribute(
      'src',
      `data:image/png;base64,${pngs[0]}`
    )
    preview = await reveal('deleted.png')
    await expectDecoded(preview, 1)
    await expect(preview.getByRole('img')).toHaveAttribute('alt', 'Before (HEAD): deleted.png')
    preview = await reveal('renamed.png')
    await expectDecoded(preview, 2)
    await expect(preview.getByRole('img').first()).toHaveAttribute('alt', 'Before (HEAD): old.png')
    preview = await reveal('vector.svg')
    await expectDecoded(preview, 1)
    preview = await reveal('large.png')
    await expect(preview).toContainText('Image exceeds the 5 MB preview limit.')
    preview = await reveal('broken.png')
    await expect(preview).toContainText('This image could not be displayed.')
    preview = await reveal('data.bin')
    await expect(preview).toContainText('No preview is available for this binary file.')

    await pane.getByRole('button', { name: 'Collapse all diffs', exact: true }).click()
    await expect(pane.getByTestId('changes-file-preview')).toHaveCount(0)
    await expect(diff).not.toContainText('text still works')
    const imageHeader = block('a-new.png').getByTestId('changes-file-header')
    const textHeader = block('README.md').locator('[data-diffs-header]')
    await expect(imageHeader).toHaveCSS('height', '32px')
    await expect(textHeader).toHaveCSS('height', '32px')
    await page.screenshot({ path: '/tmp/cerebro-changes-mixed-headers.png' })
    await pane.getByRole('treeitem', { name: 'a-new.png', exact: true }).click()
    await expectDecoded(previewFor('a-new.png'), 1)
    await expect(block('a-new.png')).toBeInViewport()
    await block('a-new.png')
      .getByRole('button', { name: 'Collapse a-new.png', exact: true })
      .click()
    await initialSelection.focus()
    await page.keyboard.press('Enter')
    await expectDecoded(previewFor('a-new.png'), 1)
    await expect(
      block('README.md').getByRole('button', { name: 'Expand README.md', exact: true })
    ).toBeVisible()
    await pane.getByRole('treeitem', { name: 'README.md', exact: true }).click()
    await expect(block('README.md')).toContainText('text still works')
    await expect(previewFor('a-new.png')).toHaveCount(1)
    await pane.getByRole('button', { name: 'Expand all diffs', exact: true }).click()
    await expect(block('renamed.png').getByRole('img')).toHaveCount(2)
    // A changeset containing only images still has a complete scrolling review.
    await execFileAsync('git', ['add', '.'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'review baseline'], { cwd: repo })
    await writeFile(join(repo, 'a-new.png'), after)
    await pane.getByTestId('changes-refresh').click()
    await expect(diff.locator('[data-change-path]')).toHaveCount(1)
    await expectDecoded(previewFor('a-new.png'), 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('expands and collapses Pierre folders and preserves expansion across refresh and panel hiding', async ({
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
    const folder = pane.getByRole('treeitem', { name: 'src', exact: true })
    const fileRow = pane.locator('[role="treeitem"][data-item-path="src/util/hello.ts"]')
    await expect(fileRow).toBeVisible()
    await expect(fileRow).toHaveAttribute('data-item-git-status', 'untracked')
    await expect(pane.getByRole('button', { name: 'Flat list' })).toHaveCount(0)
    await expect(folder).toHaveAttribute('aria-expanded', 'true')
    await folder.click()
    await expect(folder).toHaveAttribute('aria-expanded', 'false')
    await expect(fileRow).toBeHidden()

    await writeFile(join(repo, 'src', 'util', 'new.ts'), 'export const fresh = true\n')
    await pane.getByTestId('changes-refresh').click()
    await expect(pane.getByTestId('changes-diff')).toContainText('fresh')
    await expect(folder).toHaveAttribute('aria-expanded', 'false')
    await pane.getByTestId('changes-sidebar-toggle').filter({ visible: true }).click()
    await pane.getByTestId('changes-sidebar-toggle').filter({ visible: true }).click()
    await expect(folder).toHaveAttribute('aria-expanded', 'false')

    await folder.focus()
    await page.keyboard.press('ArrowRight')
    await expect(folder).toHaveAttribute('aria-expanded', 'true')
    await expect(fileRow).toBeVisible()
    await expect(pane.locator('[role="treeitem"][data-item-path="src/util/new.ts"]')).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(fileRow).toBeHidden()
    await folder.click()
    await fileRow.click()
    await expect(fileRow).toHaveAttribute('aria-selected', 'true')
    await expect(pane.getByTestId('changes-diff')).toContainText('hello')
    await page.screenshot({ path: '/tmp/cerebro-pierre-tree.png' })
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
    await expect(rootChanges.locator('[role="treeitem"][data-item-type="file"]')).toHaveCount(2)
    await expect(rootChanges.getByTestId('changes-diff')).toContainText('front-change')
    await expect(rootChanges.getByTestId('changes-diff')).toContainText('back-change')

    await page.getByTestId(`workspace-row-${frontendWorkspace?.id}`).click()
    await openChanges(page)
    const repoChanges = activeChanges(page)
    await expect(repoChanges.locator('[role="treeitem"][data-item-type="file"]')).toHaveCount(1, {
      timeout: 15_000
    })
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
    await expect(page.getByTestId('add-tab-menu')).toBeVisible()
    await expect(page.getByTestId('open-terminal-tab')).toBeVisible()
    await expect(page.getByTestId('open-changes-tab')).toBeVisible()
    await expect(page.getByTestId('open-changes-tab').getByTestId('shortcut-kbd')).toHaveAttribute(
      'data-hotkey',
      'Mod+Shift+G'
    )
    await page.getByTestId('open-terminal-tab').click()
    await expect(page.getByTestId('add-tab-menu')).toHaveCount(0)
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
    await expect(page.locator('[role="treeitem"][data-item-type="file"]')).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('opens Changes with Mod+Shift+G and focuses the existing tab on repeat', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-keybind-e2e-'))
  const repo = join(root, 'changed-keybind')

  try {
    await initGitRepo(repo, 'main', 'changed-keybind')
    await writeFile(join(repo, 'README.md'), 'changed-keybind\nhello from keybind\n')
    await addDirectoryViaUi(page, electronApp, repo)

    const sidebar = page.locator('[data-slot="sidebar"]')
    const project = await listedProject(page, 'changed-keybind')
    const workspaceId = project?.workspaces[0]?.id
    expect(workspaceId).toBeTruthy()
    const workspaceRow = page.getByTestId(`workspace-row-${workspaceId}`)

    await page.keyboard.press(openChangesChord())
    await expect(page.getByTestId('changes-tab')).toHaveCount(0)

    await sidebar
      .getByTestId(/project-row-/)
      .filter({ hasText: 'changed-keybind' })
      .focus()
    await page.keyboard.press(openChangesChord())
    await expect(page.getByTestId('changes-tab')).toHaveCount(0)

    await workspaceRow.focus()
    await page.keyboard.press(openChangesChord())
    await expect(page.getByTestId('changes-tab')).toBeVisible()
    await expect(activeChanges(page)).toBeVisible()
    await expect(
      activeChanges(page).locator('[role="treeitem"][data-item-type="file"]')
    ).toBeVisible({
      timeout: 15_000
    })
    await expect(page.getByTestId('changes-tab')).toHaveCount(1)

    await page.keyboard.press(openChangesChord())
    await expect(page.getByTestId('changes-tab')).toHaveCount(1)
    await expect(activeChanges(page)).toHaveCSS('visibility', 'visible')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resizes and collapses the Changes files panel', async ({ page, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-changes-panel-e2e-'))
  const repo = join(root, 'changed-panel')

  try {
    await initGitRepo(repo, 'main', 'changed-panel')
    await writeFile(join(repo, 'README.md'), 'changed-panel\nhello from panel\n')
    await addDirectoryViaUi(page, electronApp, repo)
    await selectDefaultWorkspace(page, 'changed-panel')

    await openChanges(page)
    const pane = activeChanges(page)
    const sidebar = pane.getByTestId('changes-sidebar')
    const diff = pane.getByTestId('changes-diff')
    const fileRow = pane.getByRole('treeitem', { name: 'README.md', exact: true })
    await expect(fileRow).toBeVisible({ timeout: 15_000 })
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')

    const before = await sidebar.boundingBox()
    expect(before).toBeTruthy()
    const rail = pane.getByTestId('changes-sidebar-rail')
    const railBox = await rail.boundingBox()
    expect(railBox).toBeTruthy()
    const startX = railBox!.x + railBox!.width / 2
    const startY = railBox!.y + Math.min(40, railBox!.height / 2)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - 80, startY, { steps: 8 })
    await page.mouse.up()

    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeGreaterThan((before!.width ?? 0) + 40)

    const expandedDiff = await diff.boundingBox()
    await pane.getByTestId('changes-sidebar-toggle').filter({ visible: true }).click()
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
    await expect(fileRow).toBeHidden()
    await expect(pane.getByRole('button', { name: 'Expand files' })).toBeVisible()
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 999).toBeLessThan(48)
    await expect
      .poll(async () => (await diff.boundingBox())?.width ?? 0)
      .toBeGreaterThan(expandedDiff!.width)

    await pane.getByTestId('changes-sidebar-toggle').filter({ visible: true }).click()
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')
    await expect(fileRow).toBeVisible()
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeGreaterThan((before!.width ?? 0) + 40)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
