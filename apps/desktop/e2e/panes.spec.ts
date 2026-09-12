import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Project, WorkspaceTab, Pane } from '@cerebro/core'
import type { Locator } from '@playwright/test'
import { test, expect, stopMux, type Page, type ElectronApplication } from './fixtures'

const exec = promisify(execFile)
const cliPath = resolve(__dirname, '../../cli/dist/index.js')
// Build the real CLI, including on CI where only the Electron build exists.
test.beforeAll(async () => {
  await exec('pnpm', ['--filter', '@cerebro/core', 'build'], {
    cwd: resolve(__dirname, '../../..')
  })
  await exec('pnpm', ['--filter', '@cerebro/cli', 'build'], { cwd: resolve(__dirname, '../../..') })
})
async function cli<T = WorkspaceTab[]>(home: string, ...args: string[]): Promise<T> {
  const { stdout } = await exec(process.execPath, ['--no-warnings', cliPath, ...args], {
    env: { ...process.env, CEREBRO_HOME: home, CEREBRO_WORKSPACE_ID: '' }
  })
  return JSON.parse(stdout)
}
async function repo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await exec('git', ['init', '-b', 'main'], { cwd: dir })
  await writeFile(join(dir, 'example.txt'), 'before\n')
  await exec('git', ['add', '.'], { cwd: dir })
  await exec(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'],
    { cwd: dir }
  )
  await writeFile(join(dir, 'example.txt'), 'after\n')
}
async function homeOf(app: ElectronApplication): Promise<string> {
  return app.evaluate(() => process.env.CEREBRO_HOME!)
}
async function selectWorkspace(page: Page, id: number): Promise<void> {
  const project = page.getByTestId(/project-row-/).first()
  await expect(project).toBeVisible()
  if ((await project.getAttribute('aria-expanded')) === 'false') await project.click()
  await page.locator(`button[data-workspace-id="${id}"]`).click()
}
async function addPane(
  page: Page,
  direction: 'auto' | 'right' | 'down',
  kind: 'terminal' | 'changes'
): Promise<void> {
  await page.getByTestId('new-terminal-tab').click()
  await page.getByTestId(`pane-menu-${direction}`).hover()
  await page.getByTestId(`add-pane-${direction}-${kind}`).click()
  await expect(page.getByTestId('add-tab-menu')).toHaveCount(0)
}
const visiblePanes = (page: Page): Locator => page.locator('[data-testid="pane"]:visible')
const pane = (page: Page, id: number): Locator =>
  page.locator(`[data-testid="pane"][data-pane-id="${id}"]`)
async function shell(page: Page, id: number, command: string): Promise<void> {
  const input = pane(page, id).locator('.xterm-helper-textarea')
  await expect(input).toBeAttached()
  await pane(page, id).getByTestId('pane-id').click()
  await input.focus()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test('UI adds mixed BSP panes, preserves terminals, resizes and collapses splits', async ({
  page,
  electronApp
}, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), 'cerebro-pane-ui-'))
  try {
    await repo(dir)
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1450, 900)
    )
    await electronApp.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, dir)
    await page.getByRole('button', { name: 'Add project' }).first().click()
    await page.getByRole('button', { name: /choose folder/i }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const listed = await page.evaluate(() => window.cerebro.listProjects())
    const workspaceId = listed.projects[0].workspaces[0].id
    await selectWorkspace(page, workspaceId)
    await page.getByTestId('new-terminal-tab').click()
    await page.getByTestId('open-terminal-tab').click()
    await expect(visiblePanes(page)).toHaveCount(1)
    const first = Number(await visiblePanes(page).first().getAttribute('data-pane-id'))
    await expect(pane(page, first).getByTestId('pane-border')).toHaveCSS('box-shadow', 'none')
    await expect(
      pane(page, first).getByRole('button', { name: `Close pane ${first}`, exact: true })
    ).toHaveCount(0)
    await expect(pane(page, first).getByTestId('pane-id')).toBeVisible()
    const contentBounds = (await pane(page, first).getByTestId('pane-content').boundingBox())!
    const frameBounds = (await pane(page, first).boundingBox())!
    expect(contentBounds.y).toBe(frameBounds.y)
    expect(contentBounds.height).toBe(frameBounds.height)
    await shell(page, first, 'export CEREBRO_PANE_PROBE=still-alive')
    await pane(page, first)
      .locator('.xterm')
      .evaluate((el) => {
        el.setAttribute('data-preserved', 'yes')
      })
    await addPane(page, 'auto', 'terminal')
    await expect(visiblePanes(page)).toHaveCount(2)
    await expect(page.getByTestId('pane-divider')).toHaveAttribute('data-direction', 'right')
    const second = Number(
      await page.locator('[data-pane-active="true"]').getAttribute('data-pane-id')
    )
    await expect(pane(page, second).locator('.xterm')).toBeVisible()
    // The new pane is tall after the first split, so automatic placement goes down.
    await expect
      .poll(async () => {
        const bounds = await pane(page, second).boundingBox()
        return bounds!.height > bounds!.width
      })
      .toBe(true)
    await addPane(page, 'auto', 'changes')
    await expect(visiblePanes(page)).toHaveCount(3)
    await expect(page.getByTestId('pane-divider').last()).toHaveAttribute('data-direction', 'down')
    const third = Number(
      await page.locator('[data-pane-active="true"]').getAttribute('data-pane-id')
    )
    await expect(pane(page, third).getByTestId('changes-view')).toBeVisible()
    await expect(pane(page, third).getByTestId('changes-view')).toContainText('example.txt')
    await expect(pane(page, first).locator('.xterm')).toHaveAttribute('data-preserved', 'yes')
    await expect(page.locator('[data-pane-active="true"]')).toHaveCount(1)
    const glow = await pane(page, third)
      .getByTestId('pane-border')
      .evaluate((el) => getComputedStyle(el).boxShadow)
    expect(glow).not.toBe('none')
    const color = await pane(page, third)
      .getByTestId('pane-border')
      .evaluate((el) => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--sidebar-selected)'
        document.body.append(probe)
        const expected = getComputedStyle(probe).color
        probe.remove()
        return { expected, actual: getComputedStyle(el).borderTopColor }
      })
    expect(color.actual).toBe(color.expected)
    const inactiveBorder = await pane(page, first)
      .getByTestId('pane-border')
      .evaluate((el) => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--pane-border)'
        document.body.append(probe)
        const expected = getComputedStyle(probe).color
        probe.remove()
        return { expected, actual: getComputedStyle(el).borderTopColor }
      })
    expect(inactiveBorder.actual).toBe(inactiveBorder.expected)
    expect(inactiveBorder.actual).not.toBe(color.actual)
    // Floating controls must not cover the Changes view's own controls.
    await pane(page, third).getByTestId('changes-sidebar-toggle').filter({ visible: true }).click()
    await expect(pane(page, third).getByTestId('changes-sidebar')).toHaveAttribute(
      'data-state',
      'collapsed'
    )
    await pane(page, third).getByTestId('changes-sidebar-toggle').filter({ visible: true }).click()
    await expect(pane(page, third).getByTestId('changes-sidebar')).toHaveAttribute(
      'data-state',
      'expanded'
    )
    await pane(page, first).getByTestId('pane-id').click()
    await expect(pane(page, first)).toHaveAttribute('data-pane-active', 'true')
    await expect(pane(page, third).getByTestId('pane-border')).toHaveCSS('box-shadow', 'none')
    const before = await pane(page, first).boundingBox()
    const divider = page.getByTestId('pane-divider').first()
    const bounds = (await divider.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + 110, bounds.y + bounds.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect
      .poll(async () => (await pane(page, first).boundingBox())!.width)
      .toBeGreaterThan(before!.width + 80)
    const overlay = (await pane(page, first).getByTestId('pane-controls').boundingBox())!
    const border = (await pane(page, first).getByTestId('pane-border').boundingBox())!
    expect(overlay.y - border.y).toBeLessThan(10)
    expect(border.x + border.width - overlay.x - overlay.width).toBeLessThan(10)
    const content = (await pane(page, first).getByTestId('pane-content').boundingBox())!
    expect(content.y - border.y).toBeLessThan(3)
    await shell(page, first, 'printf "%s" "$CEREBRO_PANE_PROBE" > pane-probe.txt')
    await expect
      .poll(() => readFile(join(dir, 'pane-probe.txt'), 'utf8').catch(() => ''))
      .toBe('still-alive')
    await page.screenshot({ path: testInfo.outputPath('bsp-panes.png') })
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 1050)
    )
    await expect(divider).toHaveAttribute('data-direction', 'right')
    await expect(page.getByTestId('pane-divider').last()).toHaveAttribute('data-direction', 'down')
    await pane(page, third)
      .getByRole('button', { name: `Close pane ${third}`, exact: true })
      .click()
    await expect(visiblePanes(page)).toHaveCount(2)
    await expect(page.getByTestId('pane-divider')).toHaveCount(1)
    await expect(pane(page, first).locator('.xterm')).toHaveAttribute('data-preserved', 'yes')
    await pane(page, second)
      .getByRole('button', { name: `Close pane ${second}`, exact: true })
      .click()
    await expect(page.getByTestId('pane-divider')).toHaveCount(0)
    await expect(pane(page, first)).toHaveAttribute('data-pane-active', 'true')
    await expect(
      pane(page, first).getByRole('button', { name: `Close pane ${first}`, exact: true })
    ).toHaveCount(0)
    await expect(pane(page, first).getByTestId('pane-border')).toHaveCSS('box-shadow', 'none')
    await page.screenshot({ path: testInfo.outputPath('single-pane.png') })
    await page.getByTestId('terminal-tab-close').click()
    await expect(visiblePanes(page)).toHaveCount(0)
    await expect(page.getByRole('tab')).toHaveCount(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI and Electron share pane IDs, focus, BSP ratios and close behavior', async ({
  page,
  electronApp
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'cerebro-pane-cli-'))
  try {
    await repo(dir)
    const home = await homeOf(electronApp)
    const project = await cli<Project>(home, 'project', 'create', '--directory', dir)
    const workspaceId = project.workspaces[0].id
    await selectWorkspace(page, workspaceId)
    const ws = String(workspaceId)
    const tab: WorkspaceTab = await cli<WorkspaceTab>(home, 'tab', 'create', '--workspace', ws)
    await expect(pane(page, tab.activePaneId).locator('.xterm')).toBeVisible()
    const originalSession = await cli<{ sessionId: string }>(
      home,
      'pane',
      'capture',
      '--workspace',
      ws,
      '--pane',
      String(tab.activePaneId)
    )
    const added = await cli<Pane>(
      home,
      'pane',
      'split',
      '--workspace',
      ws,
      '--pane',
      String(tab.activePaneId),
      '--kind',
      'changes',
      '--direction',
      'right'
    )
    await expect(pane(page, added.id).getByTestId('changes-view')).toBeVisible()
    const third = await cli<Pane>(home, 'pane', 'split', '--workspace', ws, '--kind', 'terminal')
    await expect(pane(page, third.id).locator('.xterm')).toBeVisible()
    await expect(page.getByTestId('pane-divider').last()).toHaveAttribute('data-direction', 'down')
    const listing = await cli<(Pane & { active: boolean })[]>(
      home,
      'pane',
      'list',
      '--workspace',
      ws,
      '--tab',
      String(tab.id)
    )
    expect(listing.map((p: { id: number }) => p.id)).toEqual([tab.activePaneId, added.id, third.id])
    expect(listing.find((p: { active: boolean }) => p.active).id).toBe(third.id)
    await cli(home, 'pane', 'focus', '--workspace', ws, '--pane', String(tab.activePaneId))
    await expect(pane(page, tab.activePaneId)).toHaveAttribute('data-pane-active', 'true')
    await pane(page, added.id).getByTestId('pane-id').click()
    await expect
      .poll(
        async () =>
          (await cli<(Pane & { active: boolean })[]>(home, 'pane', 'list', '--workspace', ws)).find(
            (p: { active: boolean }) => p.active
          ).id
      )
      .toBe(added.id)
    const tabs = await cli(home, 'tab', 'list', '--workspace', ws)
    await cli(
      home,
      'pane',
      'resize',
      '--workspace',
      ws,
      '--tab',
      String(tab.id),
      '--split',
      String(tabs[0].root.id),
      '--ratio',
      '0.65'
    )
    await expect(page.getByTestId('pane-divider').first()).toHaveAttribute('aria-valuenow', '65')
    const secondTab = await cli<WorkspaceTab>(
      home,
      'tab',
      'create',
      '--workspace',
      ws,
      '--kind',
      'changes'
    )
    await expect(pane(page, secondTab.activePaneId)).toBeVisible()
    await cli(home, 'tab', 'focus', '--workspace', ws, '--tab', String(tab.id))
    await expect(pane(page, added.id)).toHaveAttribute('data-pane-active', 'true')
    // Hidden renderers may unmount; the owning shell must remain the same.
    const reattachedSession = await cli<{ sessionId: string }>(
      home,
      'pane',
      'capture',
      '--workspace',
      ws,
      '--pane',
      String(tab.activePaneId)
    )
    expect(reattachedSession.sessionId).toBe(originalSession.sessionId)
    await cli(
      home,
      'tab',
      'reorder',
      '--workspace',
      ws,
      '--tab',
      String(secondTab.id),
      '--index',
      '0'
    )
    await expect(page.getByRole('tab').first()).toHaveAttribute(
      'data-terminal-tab-id',
      String(secondTab.id)
    )
    await cli(home, 'pane', 'close', '--workspace', ws, '--pane', String(added.id))
    await expect(pane(page, added.id)).toHaveCount(0)
    await expect(pane(page, third.id)).toHaveAttribute('data-pane-active', 'true')
    // Process exit retains output; explicit close removes only that pane.
    await shell(page, third.id, 'exit')
    await expect(pane(page, third.id).getByText('Shell exited', { exact: true })).toBeVisible()
    await cli(home, 'pane', 'close', '--workspace', ws, '--pane', String(third.id))
    await expect(pane(page, third.id)).toHaveCount(0)
    await expect(pane(page, tab.activePaneId)).toBeVisible()
    await cli(home, 'pane', 'close', '--workspace', ws, '--pane', String(tab.activePaneId))
    expect(
      (await cli(home, 'tab', 'list', '--workspace', ws)).map((t: { id: number }) => t.id)
    ).toEqual([secondTab.id])
    await cli(home, 'tab', 'close', '--workspace', ws, '--tab', String(secondTab.id))
    await expect(page.getByRole('tab')).toHaveCount(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI rejects invalid and cross-workspace targets without changing the layout', async ({
  page,
  electronApp
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'cerebro-pane-scope-'))
  try {
    await repo(join(dir, 'one'))
    await repo(join(dir, 'two'))
    const home = await homeOf(electronApp)
    const project = await cli<Project>(home, 'project', 'create', '--directory', dir)
    const root = project.workspaces.find((w: { kind: string }) => w.kind === 'root')
    const nested = project.workspaces.find((w: { kind: string }) => w.kind === 'default')
    const tab = await cli<WorkspaceTab>(
      home,
      'tab',
      'create',
      '--workspace',
      String(root.id),
      '--kind',
      'changes'
    )
    await selectWorkspace(page, root.id)
    await expect(pane(page, tab.activePaneId).getByTestId('changes-view')).toContainText('one')
    await expect(pane(page, tab.activePaneId).getByTestId('changes-view')).toContainText('two')
    const other = await cli<WorkspaceTab>(home, 'tab', 'create', '--workspace', String(nested.id))
    await expect
      .poll(async () => {
        const tabs = await cli<WorkspaceTab[]>(home, 'tab', 'list', '--workspace', String(root.id))
        return tabs[0].root.type === 'pane' ? tabs[0].root.state?.selectedId : null
      })
      .toBeTruthy()
    const before = await cli(home, 'tab', 'list', '--workspace', String(root.id))
    const badCases = [
      {
        args: [
          'pane',
          'close',
          '--workspace',
          String(root.id),
          '--pane',
          String(other.activePaneId)
        ],
        code: 'not_found',
        exit: 1
      },
      {
        args: ['pane', 'split', '--workspace', String(root.id), '--tab', String(other.id)],
        code: 'not_found',
        exit: 1
      },
      {
        args: ['pane', 'split', '--workspace', String(root.id), '--kind', 'invalid'],
        code: 'usage',
        exit: 2
      },
      {
        args: [
          'pane',
          'resize',
          '--workspace',
          String(root.id),
          '--tab',
          String(tab.id),
          '--split',
          '1',
          '--ratio',
          'NaN'
        ],
        code: 'usage',
        exit: 2
      },
      { args: ['pane', 'close', '--workspace', String(root.id)], code: 'usage', exit: 2 },
      { args: ['pane', 'list'], code: 'usage', exit: 2 }
    ]
    for (const bad of badCases) {
      const error = await cli(home, ...bad.args).then(
        () => null,
        (error) => error
      )
      expect(error?.code).toBe(bad.exit)
      expect(JSON.parse(error.stderr).code).toBe(bad.code)
    }
    expect(await cli(home, 'tab', 'list', '--workspace', String(root.id))).toEqual(before)
    await cli(
      home,
      'pane',
      'focus',
      '--workspace',
      String(nested.id),
      '--pane',
      String(other.activePaneId)
    )
    await expect(pane(page, other.activePaneId).locator('.xterm')).toBeVisible()
    await expect(pane(page, tab.activePaneId)).toBeHidden()
    // UI pane creation must appear under this nested workspace in CLI results.
    await addPane(page, 'down', 'changes')
    const nestedPanes = await cli<(Pane & { active: boolean })[]>(
      home,
      'pane',
      'list',
      '--workspace',
      String(nested.id)
    )
    expect(nestedPanes).toHaveLength(2)
    // One token updates all three surfaces without changing component styles.
    await page.evaluate(() =>
      document.documentElement.style.setProperty('--sidebar-selected', 'rgb(120, 90, 220)')
    )
    await expect(page.getByTestId(`project-multi-root-${project.id}`)).toHaveCSS(
      'color',
      'rgb(120, 90, 220)'
    )
    const focused = nestedPanes.find((pane) => pane.active)!
    await expect(pane(page, focused.id).getByTestId('pane-border')).toHaveCSS(
      'border-top-color',
      'rgb(120, 90, 220)'
    )
    const rowGlow = await page
      .locator(`button[data-workspace-id="${nested.id}"]`)
      .evaluate((el) => getComputedStyle(el).boxShadow)
    const expectedGlow = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.boxShadow =
        'inset 0 0 0 1px color-mix(in srgb, var(--sidebar-selected) 24%, transparent)'
      document.body.append(probe)
      const glow = getComputedStyle(probe).boxShadow
      probe.remove()
      return glow
    })
    expect(rowGlow).toBe(expectedGlow)
    expect(await cli(home, 'tab', 'list', '--workspace', String(root.id))).toEqual(before)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI starts mux without the desktop and returns structured workspace errors', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cerebro-pane-offline-'))
  try {
    const error = await cli(home, 'tab', 'list', '--workspace', '1').then(
      () => null,
      (error) => error
    )
    expect(error?.code).toBe(1)
    expect(JSON.parse(error.stderr).code).toBe('not_found')
  } finally {
    await stopMux(home)
    await rm(home, { recursive: true, force: true })
  }
})
