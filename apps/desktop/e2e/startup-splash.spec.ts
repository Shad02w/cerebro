import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { test, expect, stopMux } from './fixtures'

const PROJECTS = 'cerebro:projects:list'
const LAYOUT = 'cerebro:layout:get'
const TERMINALS = 'cerebro:pty:open'

test('paints the splash before the renderer JavaScript loads', async ({ page }) => {
  await expect(page.getByText('Create your first project')).toBeVisible()
  let release = (): void => {}
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested = false
  await page.route('**/assets/index-*.js', async (route) => {
    requested = true
    await barrier
    await route.continue()
  })
  try {
    await page.reload({ waitUntil: 'commit' })
    await expect.poll(() => requested).toBe(true)
    await expect(page.getByTestId('startup-splash')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Cerebro', exact: true })).toBeVisible()
    await expect(page.getByTestId('startup-app')).toHaveCount(0)
    release()
    await expect(page.getByTestId('startup-splash')).toHaveCount(0)
  } finally {
    release()
    await page.unroute('**/assets/index-*.js')
  }
})

// Wrap the real handlers in controllable barriers, retaining actual mux recovery.
// Electron exposes no public handler getter; the pinned runtime keeps this map.
async function holdIpc(app: ElectronApplication, channels: string[]): Promise<void> {
  await app.evaluate(({ ipcMain }, names) => {
    type Handler = (...args: unknown[]) => unknown
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
      ._invokeHandlers
    const releases = new Map<string, () => void>()
    for (const name of names) {
      const original = handlers.get(name)
      if (!original) throw new Error(`Missing IPC handler: ${name}`)
      const barrier = new Promise<void>((resolve) => releases.set(name, resolve))
      ipcMain.removeHandler(name)
      ipcMain.handle(name, async (...args) => {
        await barrier
        return original(...args)
      })
    }
    ;(
      globalThis as typeof globalThis & { splashReleases: Map<string, () => void> }
    ).splashReleases = releases
  }, channels)
}

async function releaseIpc(app: ElectronApplication, channel: string): Promise<void> {
  await app.evaluate((_electron, name) => {
    ;(
      globalThis as typeof globalThis & { splashReleases: Map<string, () => void> }
    ).splashReleases.get(name)!()
  }, channel)
}

test('reveals all projects and restored panes together after startup barriers complete', async ({
  electronApp,
  page
}, info) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-splash-projects-'))
  try {
    await mkdir(join(root, 'alpha'))
    await mkdir(join(root, 'beta'))
    await expect(page.getByText('Create your first project')).toBeVisible()
    const saved = await page.evaluate(async (directory) => {
      const alpha = await window.cerebro.createProjectFromDirectory(`${directory}/alpha`)
      const beta = await window.cerebro.createProjectFromDirectory(`${directory}/beta`)
      const workspaceId = alpha.workspaces[0].id
      await window.cerebro.setActiveWorkspace(workspaceId)
      await window.cerebro.layoutCommand({
        target: 'tab',
        action: 'create',
        workspaceId,
        kind: 'terminal'
      })
      let layout = await window.cerebro.getLayout()
      const tab = layout.workspaces[workspaceId].tabs[0]
      await window.cerebro.layoutCommand({
        target: 'pane',
        action: 'split',
        workspaceId,
        tabId: tab.id,
        kind: 'terminal',
        direction: 'right'
      })
      await window.cerebro.layoutCommand({
        target: 'tab',
        action: 'create',
        workspaceId,
        kind: 'changes'
      })
      await window.cerebro.layoutCommand({
        target: 'tab',
        action: 'create',
        workspaceId: beta.workspaces[0].id,
        kind: 'terminal'
      })
      await window.cerebro.layoutCommand({
        target: 'tab',
        action: 'focus',
        workspaceId,
        tabId: tab.id
      })
      layout = await window.cerebro.getLayout()
      return { layout, workspaceId, projectIds: [alpha.id, beta.id] }
    }, root)
    await expect(page.locator('[data-terminal-session-id]')).toHaveCount(2)
    await holdIpc(electronApp, [PROJECTS, LAYOUT, TERMINALS])
    await page.reload()
    await expect(page.getByTestId('startup-splash')).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Opening your workspaces…')
    await expect(page.getByTestId('startup-app')).toHaveCount(0)
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible()
      )
    ).toBe(true)
    await page.screenshot({ path: info.outputPath('startup-splash.png') })

    await releaseIpc(electronApp, PROJECTS)
    await expect(page.getByTestId('startup-splash')).toBeVisible()
    await expect(page.getByTestId('startup-app')).toHaveCount(0)

    await releaseIpc(electronApp, LAYOUT)
    const shell = page.getByTestId('startup-app')
    await expect(shell).toHaveAttribute('inert', '')
    await expect(shell).toHaveCSS('opacity', '0')
    await expect(page.locator('[data-terminal-pane-id]')).toHaveCount(2)
    await expect(page.getByTestId('startup-splash')).toBeVisible()

    await releaseIpc(electronApp, TERMINALS)
    await expect(page.getByTestId('startup-splash')).toHaveCount(0)
    await expect(shell).toHaveCSS('opacity', '1')
    await expect(shell).not.toHaveAttribute('inert')
    for (const id of saved.projectIds)
      await expect(page.getByTestId(`project-row-${id}`)).toBeVisible()
    await expect(page.locator('[data-terminal-session-id]')).toHaveCount(2)
    await expect(page.locator('.xterm-helper-textarea:focus')).toHaveCount(1)
    const restored = await page.evaluate(() => window.cerebro.getLayout())
    expect(Object.keys(restored.workspaces).sort()).toEqual(
      Object.keys(saved.layout.workspaces).sort()
    )
    for (const [id, workspace] of Object.entries(saved.layout.workspaces))
      expect(
        restored.workspaces[id].tabs.map((tab) => ({ id: tab.id, root: tab.root }))
      ).toMatchObject(workspace.tabs.map((tab) => ({ id: tab.id, root: tab.root })))
    await page.screenshot({ path: info.outputPath('startup-restored.png') })

    // Background refreshes never put the already usable app behind a splash again.
    await page.evaluate(
      (workspaceId) => window.cerebro.setActiveWorkspace(workspaceId),
      saved.workspaceId
    )
    await expect(page.getByTestId('startup-splash')).toHaveCount(0)

    // A new mux process must also restore the full layout from disk before reveal.
    const home = await electronApp.evaluate(() => process.env.CEREBRO_HOME!)
    await stopMux(home)
    const env = { ...process.env, CEREBRO_HOME: home }
    delete env.CEREBRO_DB_PATH
    await promisify(execFile)(
      process.execPath,
      [resolve(__dirname, '../out/cli/cerebro.cjs'), 'server', 'start'],
      { env }
    )
    await page.reload()
    await expect(page.getByTestId('startup-splash')).toHaveCount(0)
    await expect(page.locator('[data-terminal-session-id]')).toHaveCount(2)
    const recovered = await page.evaluate(() => window.cerebro.getLayout())
    expect(recovered.epoch).not.toBe(restored.epoch)
    expect(Object.keys(recovered.workspaces).sort()).toEqual(
      Object.keys(restored.workspaces).sort()
    )
    for (const [id, workspace] of Object.entries(restored.workspaces))
      expect(recovered.workspaces[id].tabs).toMatchObject(workspace.tabs)
    for (const id of saved.projectIds)
      await expect(page.getByTestId(`project-row-${id}`)).toBeVisible()
  } finally {
    for (const channel of [PROJECTS, LAYOUT, TERMINALS])
      await releaseIpc(electronApp, channel).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps the splash while projects load even when layout has recovered', async ({
  electronApp,
  page
}) => {
  await expect(page.getByText('Create your first project')).toBeVisible()
  await holdIpc(electronApp, [PROJECTS])
  try {
    await page.reload()
    await expect(page.getByTestId('startup-splash')).toBeVisible()
    await expect(page.getByTestId('startup-app')).toHaveCount(0)
    await releaseIpc(electronApp, PROJECTS)
    await expect(page.getByTestId('startup-splash')).toHaveCount(0)
    await expect(page.getByText('Create your first project')).toBeVisible()
  } finally {
    await releaseIpc(electronApp, PROJECTS)
  }
})

test('offers retry when recovery fails instead of showing an endless splash', async ({
  electronApp,
  page
}) => {
  await expect(page.getByText('Create your first project')).toBeVisible()
  await electronApp.evaluate(({ ipcMain }, channel) => {
    type Handler = (...args: unknown[]) => unknown
    const original = (
      ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
    )._invokeHandlers.get(channel)!
    let fail = true
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (...args) => {
      if (fail) {
        fail = false
        throw new Error('Test recovery failure')
      }
      return original(...args)
    })
  }, LAYOUT)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Test recovery failure')
  await expect(page.getByTestId('startup-app')).toHaveCount(0)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByTestId('startup-splash')).toHaveCount(0)
  await expect(page.getByText('Create your first project')).toBeVisible()
})
