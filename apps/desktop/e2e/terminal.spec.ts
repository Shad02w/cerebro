import type { Locator } from '@playwright/test'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test, stopMux, type ElectronApplication, type Page } from './fixtures'

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

async function addProjectViaUi(page: Page, gitUrl: string, projectName: string): Promise<void> {
  await page.getByRole('button', { name: 'Add project' }).first().click()
  await page.getByLabel('Git URL').fill(gitUrl)
  await page.getByRole('button', { name: 'Clone repository' }).click()
  await expect(page.getByTestId(/project-row-/).filter({ hasText: projectName })).toBeVisible({
    timeout: 60_000
  })
}

async function mockChooseFolder(
  electronApp: ElectronApplication,
  directory: string
): Promise<void> {
  await electronApp.evaluate(async ({ dialog }, dir: string) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, directory)
}

async function selectWorkspaceRow(page: Page, name: string): Promise<void> {
  const sidebar = page.locator('[data-slot="sidebar"]')
  await sidebar
    .getByTestId(/workspace-row-/)
    .filter({ hasText: name })
    .click()
}

async function openAddTabMenu(page: Page): Promise<void> {
  const menu = page.getByTestId('add-tab-menu')
  if (await menu.isVisible()) return
  await page.getByTestId('new-terminal-tab').click()
  await expect(menu).toBeVisible()
}

async function clickNewTerminalMenu(page: Page): Promise<void> {
  await openAddTabMenu(page)
  await page.getByTestId('open-terminal-tab').click()
  await expect(page.getByTestId('add-tab-menu')).toHaveCount(0)
}

async function clickOpenChanges(page: Page): Promise<void> {
  await openAddTabMenu(page)
  await page.getByTestId('open-changes-tab').click()
  await expect(page.getByTestId('add-tab-menu')).toHaveCount(0)
  await expect(page.getByTestId('changes-tab')).toBeVisible()
}

function contentTabs(page: Page): Locator {
  return page.locator('[data-testid="terminal-tab-bar"] [role="tab"]')
}

async function contentTabLabels(page: Page): Promise<string[]> {
  return contentTabs(page).evaluateAll((tabs) =>
    tabs.map((tab) => tab.querySelector('span')?.textContent?.trim() ?? '')
  )
}

async function dragTabTo(
  page: Page,
  sourceLabel: string,
  targetLabel: string,
  edge: 'start' | 'end'
): Promise<void> {
  const source = contentTabs(page).filter({ hasText: sourceLabel })
  const target = contentTabs(page).filter({ hasText: targetLabel })
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  expect(from).toBeTruthy()
  expect(to).toBeTruthy()

  const swapProbe = page.evaluate(() => {
    const bar = document.querySelector('[data-testid="terminal-tab-bar"]')
    if (!bar) {
      return Promise.resolve({
        seenTransform: false,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      })
    }
    return new Promise<{
      seenTransform: boolean
      reducedMotion: boolean
    }>((resolve) => {
      const seen = {
        seenTransform: false,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      }
      const observe = (): void => {
        for (const el of bar.querySelectorAll('[role="tab"]')) {
          try {
            if (Math.abs(new DOMMatrix(getComputedStyle(el).transform).m41) > 0.5) {
              seen.seenTransform = true
            }
          } catch {
            /* ignore */
          }
        }
      }
      const observer = new MutationObserver(observe)
      observer.observe(bar, {
        subtree: true,
        attributes: true,
        attributeFilter: ['style']
      })
      window.setTimeout(() => {
        observer.disconnect()
        resolve(seen)
      }, 600)
    })
  })

  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
  await page.mouse.down()
  const endX = edge === 'start' ? to!.x + 8 : to!.x + to!.width - 8
  await page.mouse.move(endX, to!.y + to!.height / 2, { steps: 20 })
  await page.mouse.up()
  const probe = await swapProbe
  if (!probe.reducedMotion) {
    expect(probe.seenTransform).toBe(true)
  }
  await expect
    .poll(async () =>
      contentTabs(page).evaluateAll((tabs) =>
        tabs.every((tab) => {
          const transform = getComputedStyle(tab).transform
          return (
            transform === 'none' ||
            transform === 'matrix(1, 0, 0, 1, 0, 0)' ||
            transform === 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'
          )
        })
      )
    )
    .toBe(true)
}

async function openNewTerminal(page: Page): Promise<void> {
  await clickNewTerminalMenu(page)
  await waitForActiveTerminal(page)
}

function newTerminalChord(): string {
  return process.platform === 'darwin' ? 'Meta+t' : 'Control+t'
}

async function openTerminalWithKeybind(page: Page): Promise<void> {
  await page.keyboard.press(newTerminalChord())
  await waitForActiveTerminal(page)
}

async function waitForActiveTerminal(page: Page): Promise<void> {
  const host = page.locator('[data-terminal-active="true"] .xterm')
  await expect(host).toBeVisible({ timeout: 30_000 })
  const box = await host.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThan(40)
  await host.click()
}

async function expectActiveGpuRenderer(page: Page): Promise<void> {
  const info = await page.evaluate(() => {
    const host = document.querySelector(
      '[data-terminal-active="true"] .terminal-host'
    ) as HTMLElement | null
    const probe = document.createElement('canvas')
    return {
      renderer: host?.dataset.terminalRenderer ?? '',
      webglAvailable: Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))
    }
  })
  if (info.webglAvailable) {
    expect(info.renderer).toBe('webgl')
  } else {
    expect(['dom']).toContain(info.renderer)
  }
}

async function exitActiveTerminal(page: Page): Promise<void> {
  await waitForActiveTerminal(page)
  await page.keyboard.press('Control+C')
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
}

async function readActiveWorkspace(page: Page): Promise<{
  id: number | null
  localPath: string | null
  kind: string | null
}> {
  return page.evaluate(async () => {
    const current = await window.cerebro.listProjects()
    if (current.activeWorkspaceId == null) {
      return { id: null, localPath: null, kind: null }
    }
    const workspace = current.projects
      .flatMap((project) => project.workspaces)
      .find((item) => item.id === current.activeWorkspaceId)
    return {
      id: current.activeWorkspaceId,
      localPath: workspace?.localPath ?? null,
      kind: workspace?.kind ?? null
    }
  })
}

test('does not spawn a terminal until New terminal is clicked; project row only expands', async ({
  page
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-terminal-e2e-'))
  const sourceA = join(sourcesRoot, 'term-alpha')
  const sourceB = join(sourcesRoot, 'term-beta')

  try {
    await initGitRepo(sourceA, 'main', 'alpha-terminal')
    await initGitRepo(sourceB, 'develop', 'beta-terminal')

    await addProjectViaUi(page, `file://${sourceA}`, 'term-alpha')

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(
      sidebar.getByTestId(/project-row-/).filter({ hasText: 'term-alpha' })
    ).toBeVisible()
    await expect(sidebar.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toBeVisible()
    await expect(sidebar.locator('[data-sidebar="menu-sub"]')).toHaveCSS('border-left-width', '0px')
    await expect(sidebar.locator('[data-sidebar="menu-sub"]')).toHaveCSS('margin-right', '0px')
    await expect(sidebar.locator('[data-sidebar="menu-sub"]')).toHaveCSS('padding-right', '0px')

    // file:// projects are not GitHub-linked, so per-project + is hidden.
    await expect(page.getByTestId(/project-add-workspace-/)).toHaveCount(0)

    const listedAfterCreate = await page.evaluate(async () => window.cerebro.listProjects())
    expect(listedAfterCreate.activeWorkspaceId).toBeNull()
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)
    await expect(page.getByTestId('brain-mark')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

    // Collapsing the project hides workspaces and still does not open a terminal.
    await page
      .getByTestId(/project-row-/)
      .filter({ hasText: 'term-alpha' })
      .click()
    await expect(sidebar.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toBeHidden()
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)

    await page
      .getByTestId(/project-row-/)
      .filter({ hasText: 'term-alpha' })
      .click()
    await expect(sidebar.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toBeVisible()
    await selectWorkspaceRow(page, 'main')

    const workspaceAId = await page.evaluate(async () => {
      const listed = await window.cerebro.listProjects()
      return listed.activeWorkspaceId
    })
    expect(workspaceAId).not.toBeNull()

    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.getByTestId('new-terminal-tab')).toBeVisible()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

    await openNewTerminal(page)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"] .xterm`)
    ).toBeVisible()
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"][data-terminal-active="true"]`)
    ).toHaveCount(1)

    // Collapsing the project hides workspaces but does not change the active terminal.
    await page
      .getByTestId(/project-row-/)
      .filter({ hasText: 'term-alpha' })
      .click()
    await expect(sidebar.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toBeHidden()
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"][data-terminal-active="true"]`)
    ).toHaveCount(1)

    await page
      .getByTestId(/project-row-/)
      .filter({ hasText: 'term-alpha' })
      .click()
    await expect(sidebar.getByTestId(/workspace-row-/).filter({ hasText: 'main' })).toBeVisible()

    await addProjectViaUi(page, `file://${sourceB}`, 'term-beta')
    await expect(sidebar.getByTestId(/project-row-/).filter({ hasText: 'term-beta' })).toBeVisible()
    await page
      .getByTestId(/project-row-/)
      .filter({ hasText: 'term-beta' })
      .click()
    await expect(sidebar.getByTestId(/workspace-row-/).filter({ hasText: 'develop' })).toBeVisible()

    // Adding another project must not steal focus or spawn a second tab strip.
    const listedAfterSecond = await page.evaluate(async () => window.cerebro.listProjects())
    expect(listedAfterSecond.activeWorkspaceId).toBe(workspaceAId)
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(1)
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"][data-terminal-active="true"]`)
    ).toHaveCount(1)

    await selectWorkspaceRow(page, 'develop')

    const workspaceBId = await page.evaluate(async () => {
      const listed = await window.cerebro.listProjects()
      return listed.activeWorkspaceId
    })
    expect(workspaceBId).not.toBeNull()
    expect(workspaceBId).not.toBe(workspaceAId)

    await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
    await expect(page.locator(`[data-terminal-workspace-id="${workspaceBId}"]`)).toHaveCount(0)
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"][data-terminal-active="false"]`)
    ).toHaveCount(0)

    await openNewTerminal(page)
    await expect(page.locator('.xterm')).toHaveCount(1)
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceBId}"][data-terminal-active="true"]`)
    ).toHaveCount(1)
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"][data-terminal-active="false"]`)
    ).toHaveCount(0)

    // Hidden renderers detach; the daemon retains their shells and screen state.
    await expect(page.locator(`[data-terminal-workspace-id="${workspaceAId}"]`)).toBeHidden()

    // Expand term-alpha if collapsed and select its workspace.
    const alphaProject = sidebar.getByTestId(/project-row-/).filter({ hasText: 'term-alpha' })
    const alphaWorkspace = sidebar.getByTestId(/workspace-row-/).filter({ hasText: 'main' })
    if (!(await alphaWorkspace.isVisible())) {
      await alphaProject.click()
    }
    await alphaWorkspace.click()

    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"][data-terminal-active="true"]`)
    ).toHaveCount(1)
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceBId}"][data-terminal-active="false"]`)
    ).toHaveCount(0)
    await expect(page.locator('.xterm')).toHaveCount(1)

    const chrome = await page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="window-drag-overlay"]')
      const stack = document.querySelector('[data-testid="terminal-stack"]')
      const tabBar = document.querySelector('[data-testid="terminal-tab-bar"]')
      const sessions = document.querySelector('[data-testid="terminal-sessions"]')
      const sidebarEl = document.querySelector('[data-slot="sidebar"]')
      const host = document.querySelector(
        '[data-terminal-active="true"] .terminal-host'
      ) as HTMLElement | null
      const xterm = host?.querySelector('.xterm')
      const viewport = host?.querySelector('.xterm-scrollable-element') as HTMLElement | null
      if (
        !overlay ||
        !stack ||
        !tabBar ||
        !sessions ||
        !sidebarEl ||
        !host ||
        !xterm ||
        !viewport
      ) {
        throw new Error('Terminal chrome elements were not found.')
      }

      const stackBox = stack.getBoundingClientRect()
      const tabBarBox = tabBar.getBoundingClientRect()
      const sessionsBox = sessions.getBoundingClientRect()
      const xtermBox = xterm.getBoundingClientRect()
      const overlayBox = overlay.getBoundingClientRect()
      const sidebarBox = sidebarEl.getBoundingClientRect()
      const sample = '\uE0A0\uE0B0'
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D context is unavailable.')
      const family = host.dataset.terminalFont ?? ''
      ctx.font = `16px "${family}"`
      const nerdWidth = ctx.measureText(sample).width
      ctx.font = '16px Menlo, Monaco, monospace'
      const menloWidth = ctx.measureText(sample).width

      const probe = document.createElement('canvas')
      const webglAvailable = Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))

      return {
        overlayPosition: getComputedStyle(overlay).position,
        overlayTop: overlayBox.top,
        overlayHeight: overlayBox.height,
        overlayWidth: overlayBox.width,
        windowWidth: window.innerWidth,
        stackTop: stackBox.top,
        tabBarTop: tabBarBox.top,
        tabBarHeight: tabBarBox.height,
        tabBarLeft: tabBarBox.left,
        tabBarPaddingLeft: getComputedStyle(tabBar).paddingLeft,
        sidebarRight: sidebarBox.right,
        sessionsTop: sessionsBox.top,
        xtermTop: xtermBox.top,
        xtermHeight: xtermBox.height,
        font: family,
        renderer: host.dataset.terminalRenderer ?? '',
        webglAvailable,
        overflowY: getComputedStyle(viewport).overflowY,
        scrollbarGutter: viewport.offsetWidth - viewport.clientWidth,
        nerdWidth,
        menloWidth
      }
    })

    expect(chrome.overlayPosition).toBe('fixed')
    expect(chrome.overlayTop).toBe(0)
    expect(chrome.overlayWidth).toBe(chrome.windowWidth)
    expect(chrome.overlayHeight).toBe(44)
    expect(chrome.stackTop).toBe(0)
    expect(chrome.tabBarTop).toBe(0)
    expect(chrome.tabBarHeight).toBe(44)
    expect(chrome.tabBarLeft).toBeGreaterThanOrEqual(chrome.sidebarRight - 1)
    expect(chrome.tabBarPaddingLeft).toBe('0px')
    expect(chrome.sessionsTop).toBe(chrome.tabBarTop + chrome.tabBarHeight)
    expect(chrome.xtermTop).toBeGreaterThanOrEqual(chrome.sessionsTop)
    expect(chrome.xtermHeight).toBeGreaterThan(40)
    expect(chrome.font).toMatch(/Nerd Font|MesloLGS|Cerebro Mono/)
    if (chrome.webglAvailable) {
      expect(chrome.renderer).toBe('webgl')
    } else {
      expect(chrome.renderer).toBe('dom')
    }
    // v6 uses its custom scrollable element instead of native overflow.
    expect(chrome.overflowY).toBe('visible')
    expect(chrome.scrollbarGutter).toBe(0)
    expect(chrome.nerdWidth).toBeGreaterThan(0)
    expect(chrome.nerdWidth).not.toBe(chrome.menloWidth)
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

test('supports multiple terminal tabs; shell exit retains output and can restart', async ({
  page
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-terminal-tabs-e2e-'))
  const source = join(sourcesRoot, 'term-tabs')

  try {
    await initGitRepo(source, 'main', 'tabs-terminal')
    await addProjectViaUi(page, `file://${source}`, 'term-tabs')
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)

    await selectWorkspaceRow(page, 'main')

    const workspaceId = await page.evaluate(async () => {
      const listed = await window.cerebro.listProjects()
      return listed.activeWorkspaceId
    })
    expect(workspaceId).not.toBeNull()

    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

    await openNewTerminal(page)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
    await expect(
      page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 1' })
    ).toHaveAttribute('data-active', 'true')
    await expect(page.locator(`[data-terminal-workspace-id="${workspaceId}"] .xterm`)).toHaveCount(
      1
    )

    await clickNewTerminalMenu(page)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
    await expect(
      page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 2' })
    ).toHaveAttribute('data-active', 'true')
    await waitForActiveTerminal(page)
    await expect(page.locator(`[data-terminal-workspace-id="${workspaceId}"] .xterm`)).toHaveCount(
      1
    )
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceId}"][data-terminal-active="true"]`)
    ).toHaveCount(1)
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${workspaceId}"][data-terminal-active="true"] .xterm`
      )
    ).toBeVisible()

    await page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 1' }).click()
    await expect(
      page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 1' })
    ).toHaveAttribute('data-active', 'true')
    await expect(
      page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 2' })
    ).toHaveAttribute('data-active', 'false')
    await waitForActiveTerminal(page)
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${workspaceId}"][data-terminal-tab-id][data-terminal-active="true"] .xterm`
      )
    ).toBeVisible()
    await expectActiveGpuRenderer(page)

    await page
      .getByTestId('terminal-tab')
      .filter({ hasText: 'Terminal 2' })
      .getByTestId('terminal-tab-close')
      .click()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
    await expect(page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 1' })).toBeVisible()
    await expect(page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 2' })).toHaveCount(0)
    await expect(page.locator(`[data-terminal-workspace-id="${workspaceId}"] .xterm`)).toHaveCount(
      1
    )
    await waitForActiveTerminal(page)

    await clickNewTerminalMenu(page)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
    await waitForActiveTerminal(page)

    await exitActiveTerminal(page)
    await expect(page.getByText('Shell exited', { exact: true })).toBeVisible()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    await expect(page.getByText('Shell exited', { exact: true })).toHaveCount(0)
    await waitForActiveTerminal(page)
    await exitActiveTerminal(page)
    await expect(page.getByText('Shell exited', { exact: true })).toBeVisible()
    await page
      .getByTestId('terminal-tab')
      .filter({ has: page.getByTestId('terminal-tab-close') })
      .last()
      .getByTestId('terminal-tab-close')
      .click()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
    await page.getByTestId('terminal-tab-close').click()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.getByTestId('new-terminal-tab')).toBeVisible()

    await clickNewTerminalMenu(page)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
    await waitForActiveTerminal(page)
    await expect(page.locator(`[data-terminal-workspace-id="${workspaceId}"] .xterm`)).toHaveCount(
      1
    )
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

test('does not spawn a terminal for a multi-root project until New terminal is clicked', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-multiroot-tabs-e2e-'))
  const parent = join(root, 'apps-folder')
  const frontend = join(parent, 'frontend')
  const backend = join(parent, 'backend')

  try {
    await initGitRepo(frontend, 'main', 'frontend-app')
    await initGitRepo(backend, 'main', 'backend-app')

    await mockChooseFolder(electronApp, parent)
    await page.getByRole('button', { name: 'Add project' }).first().click()
    await page.getByTestId('add-project-choose-folder').click()

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'apps-folder' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'frontend' })).toBeVisible()
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'backend' })).toBeVisible()

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    expect(listed.activeWorkspaceId).toBeNull()
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)
    await expect(page.getByTestId('brain-mark')).toBeVisible()
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

    await projectRow.click()
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'frontend' })).toBeHidden()
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)

    await projectRow.click()
    const rootRow = page.getByTestId(/project-root-/)
    await expect(rootRow).toHaveAttribute('data-active', 'false')
    await rootRow.click()

    const parentPath = await realpath(parent)
    const frontendPath = await realpath(frontend)
    const backendPath = await realpath(backend)

    const rootId = await page.evaluate(async () => {
      const current = await window.cerebro.listProjects()
      const project = current.projects.find((item) => item.name === 'apps-folder')
      const root = project?.workspaces.find((workspace) => workspace.kind === 'root')
      return {
        activeId: current.activeWorkspaceId,
        rootId: root?.id ?? null,
        rootPath: root?.localPath ?? null
      }
    })
    expect(rootId.rootId).not.toBeNull()
    expect(rootId.activeId).toBe(rootId.rootId)
    expect(rootId.rootPath).toBe(parentPath)
    await expect(rootRow).toHaveAttribute('data-active', 'true')
    await expect(
      page.getByTestId(/workspace-row-/).filter({ hasText: 'frontend' })
    ).toHaveAttribute('data-active', 'false')
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

    await openNewTerminal(page)
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${rootId.rootId}"][data-terminal-active="true"] .xterm`
      )
    ).toBeVisible()
    const rootActive = await readActiveWorkspace(page)
    expect(rootActive.kind).toBe('root')
    expect(rootActive.localPath).toBe(parentPath)

    const toggle = page.getByTestId(/root-toggle-/)
    await page.getByTestId(/project-root-/).hover()
    await toggle.click()
    await expect(page.getByTestId(/workspace-row-/).filter({ hasText: 'frontend' })).toBeHidden()
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${rootId.rootId}"][data-terminal-active="true"] .xterm`
      )
    ).toBeVisible()
    await page.getByTestId(/project-root-/).hover()
    await toggle.click()

    await selectWorkspaceRow(page, 'frontend')

    const frontendId = await page.evaluate(async () => {
      const current = await window.cerebro.listProjects()
      return current.activeWorkspaceId
    })
    expect(frontendId).not.toBeNull()
    expect(frontendId).not.toBe(rootId.rootId)
    const frontendActive = await readActiveWorkspace(page)
    expect(frontendActive.kind).toBe('default')
    expect(frontendActive.localPath).toBe(frontendPath)
    await expect(rootRow).toHaveAttribute('data-active', 'false')
    await expect(
      page.getByTestId(/workspace-row-/).filter({ hasText: 'frontend' })
    ).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
    await expect(page.locator(`[data-terminal-workspace-id="${frontendId}"]`)).toHaveCount(0)
    await expect(
      page.locator(`[data-terminal-workspace-id="${rootId.rootId}"][data-terminal-active="false"]`)
    ).toHaveCount(0)

    await openNewTerminal(page)
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${frontendId}"][data-terminal-active="true"] .xterm`
      )
    ).toBeVisible()

    await clickNewTerminalMenu(page)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
    await waitForActiveTerminal(page)

    await selectWorkspaceRow(page, 'backend')
    const backendId = await page.evaluate(async () => {
      const current = await window.cerebro.listProjects()
      return current.activeWorkspaceId
    })
    expect(backendId).not.toBe(frontendId)
    const backendActive = await readActiveWorkspace(page)
    expect(backendActive.kind).toBe('default')
    expect(backendActive.localPath).toBe(backendPath)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
    await expect(page.locator(`[data-terminal-workspace-id="${backendId}"]`)).toHaveCount(0)

    await openNewTerminal(page)
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${backendId}"][data-terminal-active="true"] .xterm`
      )
    ).toBeVisible()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('closes the active terminal tab with Mod+W and shows the shortcut on the close button', async ({
  page,
  electronApp
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-terminal-keybind-e2e-'))
  const source = join(sourcesRoot, 'term-keybind')

  try {
    await initGitRepo(source, 'main', 'keybind-terminal')
    await addProjectViaUi(page, `file://${source}`, 'term-keybind')
    await selectWorkspaceRow(page, 'main')

    await openNewTerminal(page)
    await clickNewTerminalMenu(page)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
    await waitForActiveTerminal(page)

    const closeButton = page
      .getByTestId('terminal-tab')
      .filter({ hasText: 'Terminal 2' })
      .getByTestId('terminal-tab-close')
    await closeButton.hover()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip.getByText('Close')).toBeVisible()
    await expect(tooltip.getByTestId('shortcut-kbd')).toHaveAttribute('data-hotkey', 'Mod+W')

    const closeChord = process.platform === 'darwin' ? 'Meta+w' : 'Control+w'
    await page.keyboard.press(closeChord)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
    await expect(page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 1' })).toBeVisible()
    await expect(page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 2' })).toHaveCount(0)

    // Window should still be open after closing a tab.
    expect(electronApp.windows().length).toBe(1)

    await page.keyboard.press(closeChord)
    await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    expect(electronApp.windows().length).toBe(1)

    // Allow the post-tab-close native-close guard to expire.
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(electronApp.windows().length).toBe(1)

    // With no tabs left, Mod+W closes the window. The page may close mid-press.
    await Promise.all([
      page.keyboard.press(closeChord).catch(() => undefined),
      expect.poll(() => electronApp.windows().length, { timeout: 10_000 }).toBe(0)
    ])
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

test('opens a terminal with Mod+T when a default-branch workspace row is focused', async ({
  page
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-terminal-modt-e2e-'))
  const source = join(sourcesRoot, 'term-modt')

  try {
    await initGitRepo(source, 'main', 'modt-terminal')
    await addProjectViaUi(page, `file://${source}`, 'term-modt')

    const sidebar = page.locator('[data-slot="sidebar"]')
    const workspaceRow = sidebar.getByTestId(/workspace-row-/).filter({ hasText: 'main' })
    await expect(workspaceRow).toBeVisible()
    await expect(workspaceRow).toHaveAttribute('data-workspace-role', 'branch')

    await page.keyboard.press(newTerminalChord())
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)
    await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

    await sidebar
      .getByTestId(/project-row-/)
      .filter({ hasText: 'term-modt' })
      .focus()
    await page.keyboard.press(newTerminalChord())
    await expect(page.getByTestId('terminal-tab-bar')).toHaveCount(0)

    await workspaceRow.focus()
    await openTerminalWithKeybind(page)

    const workspaceId = await page.evaluate(async () => {
      const listed = await window.cerebro.listProjects()
      return listed.activeWorkspaceId
    })
    expect(workspaceId).not.toBeNull()
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${workspaceId}"][data-terminal-active="true"] .xterm`
      )
    ).toBeVisible()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(1)

    await page.getByTestId('new-terminal-tab').click()
    const terminalItem = page.getByTestId('open-terminal-tab')
    await expect(terminalItem).toBeVisible()
    await expect(terminalItem.getByTestId('shortcut-kbd')).toHaveAttribute('data-hotkey', 'Mod+T')
    await expect(page.getByTestId('open-changes-tab').getByTestId('shortcut-kbd')).toHaveAttribute(
      'data-hotkey',
      'Mod+Shift+G'
    )
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('add-tab-menu')).toHaveCount(0)

    await page.keyboard.press(newTerminalChord())
    await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
    await waitForActiveTerminal(page)
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

test('opens a terminal with Mod+T from multi-root workspace rows', async ({
  page,
  electronApp
}) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-multiroot-modt-e2e-'))
  const parent = join(root, 'apps-folder')
  const frontend = join(parent, 'frontend')
  const backend = join(parent, 'backend')

  try {
    await initGitRepo(frontend, 'main', 'frontend-app')
    await initGitRepo(backend, 'main', 'backend-app')

    await mockChooseFolder(electronApp, parent)
    await page.getByRole('button', { name: 'Add project' }).first().click()
    await page.getByTestId('add-project-choose-folder').click()

    const projectRow = page.getByTestId(/project-row-/).filter({ hasText: 'apps-folder' })
    await expect(projectRow).toBeVisible({ timeout: 30_000 })

    const listed = await page.evaluate(async () => window.cerebro.listProjects())
    const project = listed.projects.find((item) => item.name === 'apps-folder')
    const frontendPath = await realpath(frontend)
    const rootWorkspace = project?.workspaces.find((workspace) => workspace.kind === 'root')
    const frontendWorkspace = project?.workspaces.find(
      (workspace) => workspace.localPath === frontendPath
    )
    expect(rootWorkspace).toBeTruthy()
    expect(frontendWorkspace).toBeTruthy()

    const rootRow = page.getByTestId(/project-root-/)
    await expect(rootRow).toHaveAttribute('data-workspace-role', 'root')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await rootRow.focus()
    await expect(rootRow).toBeFocused()
    await page.keyboard.press(newTerminalChord())
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${rootWorkspace!.id}"][data-terminal-active="true"] .xterm`
      )
    ).toBeVisible({ timeout: 30_000 })
    const rootState = await readActiveWorkspace(page)
    expect(rootState.kind).toBe('root')
    expect(rootState.id).toBe(rootWorkspace!.id)

    const frontendRow = page.getByTestId(/workspace-row-/).filter({ hasText: 'frontend' })
    await expect(frontendRow).toHaveAttribute('data-workspace-role', 'repository')
    await frontendRow.focus()
    await page.keyboard.press(newTerminalChord())
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${frontendWorkspace!.id}"][data-terminal-active="true"] .xterm`
      )
    ).toBeVisible({ timeout: 30_000 })
    const frontendState = await readActiveWorkspace(page)
    expect(frontendState.kind).toBe('default')
    expect(frontendState.id).toBe(frontendWorkspace!.id)
    await expect(
      page.locator(
        `[data-terminal-workspace-id="${rootWorkspace!.id}"][data-terminal-active="false"]`
      )
    ).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps the sidebar trigger visible above the tab bar when collapsed', async ({ page }) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-collapsed-trigger-e2e-'))
  const source = join(sourcesRoot, 'term-collapse')

  try {
    await initGitRepo(source, 'main', 'collapse-terminal')
    await addProjectViaUi(page, `file://${source}`, 'term-collapse')
    await selectWorkspaceRow(page, 'main')
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
    await openNewTerminal(page)
    await expect(page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 1' })).toBeVisible()

    const beforeCollapse = await page.evaluate(() => {
      const xterm = document.querySelector('[data-terminal-active="true"] .xterm')
      const sessions = document.querySelector('[data-testid="terminal-sessions"]')
      if (!(xterm instanceof HTMLElement) || !(sessions instanceof HTMLElement)) {
        throw new Error('Active terminal was not found.')
      }
      xterm.dataset.terminalInstance = 'stable'
      return { sessionsWidth: sessions.getBoundingClientRect().width }
    })

    const trigger = page.getByRole('button', { name: 'Toggle Sidebar' })
    await trigger.click()
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed')
    await expect(page.locator('.xterm[data-terminal-instance="stable"]')).toBeVisible()
    await expect
      .poll(async () => {
        const box = await page.getByTestId('terminal-sessions').boundingBox()
        return box?.width ?? 0
      })
      .toBeGreaterThan(beforeCollapse.sessionsWidth + 50)
    await expect(trigger).toBeVisible()
    await expect
      .poll(async () => {
        const box = await page.getByTestId('terminal-tab-bar').boundingBox()
        return box?.x ?? -1
      })
      .toBeLessThanOrEqual(1)

    const layout = await page.evaluate(() => {
      const appRegion = (el: Element): string => {
        const style = getComputedStyle(el) as CSSStyleDeclaration & { webkitAppRegion?: string }
        return style.getPropertyValue('-webkit-app-region') || style.webkitAppRegion || ''
      }
      const triggerEl = document.querySelector('[data-slot="sidebar-trigger"]')
      const triggerHost = document.querySelector('[data-testid="titlebar-sidebar-trigger"]')
      const tabBar = document.querySelector('[data-testid="terminal-tab-bar"]')
      const tab = document.querySelector('[data-testid="terminal-tab"]')
      const plus = document.querySelector('[data-testid="new-terminal-tab"]')
      if (!triggerEl || !triggerHost || !tabBar || !tab || !plus) {
        throw new Error('Collapsed chrome elements were not found.')
      }
      const triggerBox = triggerEl.getBoundingClientRect()
      const tabBox = tabBar.getBoundingClientRect()
      const tabButtonBox = tab.getBoundingClientRect()
      const plusBox = plus.getBoundingClientRect()
      const hit = document.elementFromPoint(
        triggerBox.left + triggerBox.width / 2,
        triggerBox.top + triggerBox.height / 2
      )
      return {
        triggerTop: triggerBox.top,
        triggerLeft: triggerBox.left,
        triggerRight: triggerBox.right,
        triggerHeight: triggerBox.height,
        triggerHostContainsButton: triggerHost.contains(triggerEl),
        triggerHostRegion: appRegion(triggerHost),
        tabLeft: tabBox.left,
        tabRight: tabBox.right,
        tabHeight: tabBox.height,
        tabButtonHeight: tabButtonBox.height,
        tabButtonTop: tabButtonBox.top,
        plusTop: plusBox.top,
        plusLeft: plusBox.left,
        plusHeight: plusBox.height,
        plusMid: plusBox.top + plusBox.height / 2,
        triggerMid: triggerBox.top + triggerBox.height / 2,
        hitIsTrigger: Boolean(hit && triggerEl.contains(hit)),
        windowWidth: window.innerWidth
      }
    })

    expect(layout.tabLeft).toBeLessThanOrEqual(1)
    expect(layout.tabRight).toBeGreaterThanOrEqual(layout.windowWidth - 1)
    expect(layout.tabHeight).toBe(44)
    expect(layout.tabButtonHeight).toBe(44)
    expect(layout.tabButtonTop).toBe(0)
    expect(layout.triggerHostContainsButton).toBe(true)
    expect(layout.triggerHostRegion).toBe('no-drag')
    expect(Math.round(layout.triggerLeft)).toBe(78)
    expect(layout.plusLeft).toBeGreaterThanOrEqual(layout.triggerRight)
    expect(layout.triggerHeight).toBe(24)
    expect(layout.plusHeight).toBe(24)
    expect(Math.round(layout.triggerTop)).toBe(Math.round(layout.plusTop))
    expect(Math.round(layout.triggerMid)).toBe(22)
    expect(Math.round(layout.plusMid)).toBe(22)
    expect(layout.hitIsTrigger).toBe(true)

    await trigger.click()
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded')
    await expect(page.getByTestId('sidebar-heading')).toHaveText('Projects')
    await expect(page.getByTestId('sidebar-heading')).toBeVisible()
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

test('sends CSI u for Ctrl+; so Neovim can bind it', async ({ page }) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-terminal-csiu-e2e-'))
  const source = join(sourcesRoot, 'term-csiu')

  try {
    await initGitRepo(source, 'main', 'csiu-terminal')
    await addProjectViaUi(page, `file://${source}`, 'term-csiu')
    await selectWorkspaceRow(page, 'main')

    const workspace = await readActiveWorkspace(page)
    expect(workspace.localPath).toBeTruthy()
    await writeFile(
      join(workspace.localPath!, 'dump-key.sh'),
      [
        '#!/bin/sh',
        'stty raw -echo',
        'printf ready > ready.txt',
        'dd bs=1 count=8 of=key.bin 2>/dev/null',
        ''
      ].join('\n')
    )

    await openNewTerminal(page)

    const term = page.getByRole('textbox', { name: 'Terminal input' })
    await expect(term).toBeFocused()
    await term.press('Control+c')
    await term.pressSequentially('sh dump-key.sh')
    await term.press('Enter')

    const readyPath = join(workspace.localPath!, 'ready.txt')
    const keyPath = join(workspace.localPath!, 'key.bin')
    await expect
      .poll(async () => {
        try {
          return await readFile(readyPath, 'utf8')
        } catch {
          return ''
        }
      })
      .toContain('ready')

    await expect(term).toBeFocused()
    await term.press('Control+Semicolon')

    await expect
      .poll(async () => {
        try {
          return (await readFile(keyPath)).toString('hex')
        } catch {
          return ''
        }
      })
      .toBe('1b5b35393b3575')
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

test('reorders content tabs by dragging', async ({ page }) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-tab-reorder-e2e-'))
  const source = join(sourcesRoot, 'tab-reorder')

  try {
    await initGitRepo(source, 'main', 'tab-reorder')
    await addProjectViaUi(page, `file://${source}`, 'tab-reorder')
    await selectWorkspaceRow(page, 'main')
    await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()

    await openNewTerminal(page)
    await clickNewTerminalMenu(page)
    await waitForActiveTerminal(page)
    await clickOpenChanges(page)
    await expect.poll(() => contentTabLabels(page)).toEqual(['Terminal 1', 'Terminal 2', 'Changes'])

    await dragTabTo(page, 'Changes', 'Terminal 1', 'start')
    await expect.poll(() => contentTabLabels(page)).toEqual(['Changes', 'Terminal 1', 'Terminal 2'])
    await expect(page.getByTestId('changes-tab')).toHaveAttribute('data-active', 'true')

    await dragTabTo(page, 'Terminal 2', 'Changes', 'start')
    await expect.poll(() => contentTabLabels(page)).toEqual(['Terminal 2', 'Changes', 'Terminal 1'])
    await expect(
      page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 2' })
    ).toHaveAttribute('data-active', 'true')

    await page.getByTestId('changes-tab').click()
    await expect(page.getByTestId('changes-tab')).toHaveAttribute('data-active', 'true')
    await expect(
      page.getByTestId('terminal-tab').filter({ hasText: 'Terminal 2' })
    ).toHaveAttribute('data-active', 'false')

    await page
      .getByTestId('terminal-tab')
      .filter({ hasText: 'Terminal 1' })
      .getByTestId('terminal-tab-close')
      .click()
    await expect.poll(() => contentTabLabels(page)).toEqual(['Terminal 2', 'Changes'])
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

test('empty workspace stays black before opening and after closing themed tabs', async ({
  page
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-empty-theme-e2e-'))
  try {
    await initGitRepo(sourcesRoot, 'main', 'empty-theme')
    await addProjectViaUi(page, `file://${sourcesRoot}`, sourcesRoot.split('/').pop()!)
    await selectWorkspaceRow(page, 'main')
    const content = page.getByTestId('terminal-sessions')
    await expect(contentTabs(page)).toHaveCount(0)
    await expect(content).toHaveCSS('background-color', 'rgb(0, 0, 0)')

    for (const [name, color] of [
      ['Dracula', 'rgb(40, 42, 54)'],
      ['Catppuccin Latte', 'rgb(239, 241, 245)']
    ]) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Terminal', exact: true }).click()
      await page.getByTestId('settings-terminal-theme').click()
      await page.getByRole('option', { name, exact: true }).click()
      await expect(page.getByTestId('settings-terminal-theme')).toHaveText(name)
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(content).toHaveCSS('background-color', 'rgb(0, 0, 0)')

      await clickNewTerminalMenu(page)
      await expect(page.locator('.terminal-host .xterm')).toHaveCount(1)
      await expect(page.locator('.terminal-host')).toHaveCSS('background-color', color)
      await page.getByTestId('terminal-tab-close').click()
      await expect(contentTabs(page)).toHaveCount(0)
      await expect(page.locator('.terminal-host')).toHaveCount(0)
      await expect(content).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    }
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})

test('terminal themes update existing and new sessions without losing output', async ({
  page,
  electronApp
}) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-theme-e2e-'))
  try {
    await initGitRepo(sourcesRoot, 'main', 'themes')
    const shell = join(sourcesRoot, 'theme-shell')
    await writeFile(shell, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n')
    await chmod(shell, 0o755)
    await page.evaluate(() => window.cerebro.getLayout())
    await electronApp.evaluate((_electron, shell) => {
      process.env.SHELL = shell
      process.env.PS1 = 'theme> '
    }, shell)
    await stopMux(await electronApp.evaluate(() => process.env.CEREBRO_HOME!))
    await page.evaluate(() => {
      const probe = { sessionId: 0, output: '' }
      ;(window as Window & { themeProbe: { sessionId: number; output: string } }).themeProbe = probe
      window.cerebro.onPtyData((event) => {
        probe.sessionId = event.sessionId
        if (event.sessionId === probe.sessionId) probe.output += event.data
      })
    })
    await addProjectViaUi(page, `file://${sourcesRoot}`, sourcesRoot.split('/').pop()!)
    await selectWorkspaceRow(page, 'main')
    await clickNewTerminalMenu(page)
    await expect(page.locator('.terminal-host .xterm')).toHaveCount(1)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { themeProbe: { sessionId: number; output: string } }).themeProbe
              .output
        )
      )
      .not.toBe('')
    await page.evaluate(async () => {
      await window.cerebro.writePty(
        (window as Window & { themeProbe: { sessionId: number; output: string } }).themeProbe
          .sessionId,
        "stty -echo; THEME_TOKEN=preserved; printf 'THEME_SESSION_PRESERVED\\n\\033[31mRED \\033[32mGREEN \\033[34mBLUE\\033[0m\\n'\n"
      )
    })
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { themeProbe: { sessionId: number; output: string } }).themeProbe
              .output
        )
      )
      .toContain('\u001b[31mRED')
    const originalSize = await page.locator('.xterm-screen').first().boundingBox()
    await clickNewTerminalMenu(page)
    await expect(page.locator('.terminal-host .xterm')).toHaveCount(1)
    const tabIds = await page
      .getByTestId('terminal-tab')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-terminal-tab-id')))
    for (const [name, color] of [
      ['Dracula', 'rgb(40, 42, 54)'],
      ['Catppuccin Latte', 'rgb(239, 241, 245)'],
      ['Xterm Default', 'rgb(0, 0, 0)'],
      ['Cerebro Default', 'rgb(10, 10, 10)'],
      ['Kanagawa Wave', 'rgb(31, 31, 40)'],
      ['Kanagawa Dragon', 'rgb(24, 22, 22)'],
      ['Kanagawa Lotus', 'rgb(242, 236, 188)'],
      ['Kanagawabones', 'rgb(31, 31, 40)'],
      ['Vercel', 'rgb(16, 16, 16)']
    ]) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Terminal', exact: true }).click()
      await page.getByTestId('settings-terminal-theme').click()
      await page.getByRole('option', { name, exact: true }).click()
      await expect(page.getByTestId('settings-terminal-theme')).toHaveText(name)
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(page.locator('.terminal-host')).toHaveCount(1)
      for (const host of await page.locator('.terminal-host').all()) {
        await expect(host).toHaveCSS('background-color', color)
        await expect(host.locator('.xterm-scrollable-element')).toHaveCSS('background-color', color)
      }
      expect(
        await page
          .getByTestId('terminal-tab')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-terminal-tab-id')))
      ).toEqual(tabIds)
      await page.getByTestId('terminal-tab').first().click()
      await waitForActiveTerminal(page)
      await page.keyboard.press('Enter')
      await expect
        .poll(async () => {
          const size = await page.locator('.xterm-screen').first().boundingBox()
          return [size?.width, size?.height]
        })
        .toEqual([originalSize?.width, originalSize?.height])
      await page.evaluate(async () => {
        const probe = (window as Window & { themeProbe: { sessionId: number; output: string } })
          .themeProbe
        probe.output = ''
        await window.cerebro.writePty(probe.sessionId, 'printf "state:%s\\n" "$THEME_TOKEN"\n')
      })
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as Window & { themeProbe: { sessionId: number; output: string } }).themeProbe
                .output
          )
        )
        .toContain('state:preserved')

      await mkdir(join(tmpdir(), 'cerebro-e2e-artifacts'), { recursive: true })
      const screen = await page.locator('.xterm-screen').first().boundingBox()
      await page.mouse.move(screen!.x + 2, screen!.y + 30)
      await page.mouse.down()
      await page.mouse.move(screen!.x + 220, screen!.y + 30, { steps: 10 })
      await page.mouse.up()
      await page.screenshot({
        path: join(tmpdir(), 'cerebro-e2e-artifacts', `theme-${name.replaceAll(' ', '-')}.png`)
      })
      await page.locator('.xterm-helper-textarea').first().press('ArrowRight')
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await page.getByTestId('settings-terminal-theme').click()
    await page.getByRole('option', { name: 'Nord', exact: true }).click()
    await expect(page.getByTestId('settings-terminal-theme')).toHaveText('Nord')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await clickNewTerminalMenu(page)
    await expect(page.locator('.terminal-host .xterm')).toHaveCount(1)
    await expect(page.locator('.terminal-host').last()).toHaveCSS(
      'background-color',
      'rgb(46, 52, 64)'
    )
    await expect(page.locator('.xterm-scrollable-element').last()).toHaveCSS(
      'background-color',
      'rgb(46, 52, 64)'
    )
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})
