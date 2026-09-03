import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test, type Page } from './fixtures'

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

async function addWorkspaceViaUi(page: Page, gitUrl: string, workspaceName: string): Promise<void> {
  await page.getByRole('button', { name: 'Add workspace' }).first().click()
  await page.getByLabel('Git URL').fill(gitUrl)
  await page.getByRole('button', { name: 'Clone repository' }).click()
  await expect(page.getByRole('button', { name: workspaceName, exact: true })).toBeVisible({
    timeout: 60_000
  })
}

test('opens keep-alive terminals per workspace without respawning', async ({ page }) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-terminal-e2e-'))
  const sourceA = join(sourcesRoot, 'term-alpha')
  const sourceB = join(sourcesRoot, 'term-beta')

  try {
    await initGitRepo(sourceA, 'main', 'alpha-terminal')
    await initGitRepo(sourceB, 'develop', 'beta-terminal')

    await addWorkspaceViaUi(page, `file://${sourceA}`, 'term-alpha')

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar.getByRole('button', { name: 'term-alpha', exact: true })).toBeVisible()
    await expect(sidebar.getByTestId(/repository-branch-/)).toHaveText('main')

    const workspaceAId = await page.evaluate(async () => {
      const listed = await window.cerebro.listWorkspaces()
      return listed.activeWorkspaceId
    })
    expect(workspaceAId).not.toBeNull()

    await expect(page.locator(`[data-terminal-workspace-id="${workspaceAId}"]`)).toBeVisible({
      timeout: 30_000
    })
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"] .xterm`)
    ).toBeVisible()
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"][data-terminal-active="true"]`)
    ).toHaveCount(1)

    await addWorkspaceViaUi(page, `file://${sourceB}`, 'term-beta')
    await expect(sidebar.getByRole('button', { name: 'term-beta', exact: true })).toBeVisible()
    await expect(sidebar.getByTestId(/repository-branch-/)).toHaveText(['develop', 'main'])

    const workspaceBId = await page.evaluate(async () => {
      const listed = await window.cerebro.listWorkspaces()
      return listed.activeWorkspaceId
    })
    expect(workspaceBId).not.toBeNull()
    expect(workspaceBId).not.toBe(workspaceAId)

    await expect(page.locator(`[data-terminal-workspace-id="${workspaceBId}"]`)).toBeVisible({
      timeout: 30_000
    })
    await expect(page.locator('.xterm')).toHaveCount(2)
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceBId}"][data-terminal-active="true"]`)
    ).toHaveCount(1)
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"][data-terminal-active="false"]`)
    ).toHaveCount(1)

    // Hidden host stays in the DOM with real layout (visibility:hidden, not display:none).
    await expect(page.locator(`[data-terminal-workspace-id="${workspaceAId}"]`)).toBeHidden()

    await page.getByRole('button', { name: 'term-alpha', exact: true }).click()

    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceAId}"][data-terminal-active="true"]`)
    ).toHaveCount(1)
    await expect(
      page.locator(`[data-terminal-workspace-id="${workspaceBId}"][data-terminal-active="false"]`)
    ).toHaveCount(1)
    await expect(page.locator('.xterm')).toHaveCount(2)

    const chrome = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="content-drag-header"]')
      const stack = document.querySelector('[data-testid="terminal-stack"]')
      const host = document.querySelector(
        '[data-terminal-active="true"] .terminal-host'
      ) as HTMLElement | null
      const xterm = host?.querySelector('.xterm')
      const viewport = host?.querySelector('.xterm-viewport') as HTMLElement | null
      if (!header || !stack || !host || !xterm || !viewport) {
        throw new Error('Terminal chrome elements were not found.')
      }

      const stackBox = stack.getBoundingClientRect()
      const xtermBox = xterm.getBoundingClientRect()
      const sample = '\uE0A0\uE0B0'
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D context is unavailable.')
      const family = host.dataset.terminalFont ?? ''
      ctx.font = `16px "${family}"`
      const nerdWidth = ctx.measureText(sample).width
      ctx.font = '16px Menlo, Monaco, monospace'
      const menloWidth = ctx.measureText(sample).width

      return {
        headerHeight: header.getBoundingClientRect().height,
        topGap: xtermBox.top - stackBox.top,
        font: family,
        overflowY: getComputedStyle(viewport).overflowY,
        scrollbarGutter: viewport.offsetWidth - viewport.clientWidth,
        nerdWidth,
        menloWidth
      }
    })

    expect(chrome.headerHeight).toBeLessThanOrEqual(16)
    expect(chrome.topGap).toBeLessThanOrEqual(8)
    expect(chrome.font).toMatch(/Nerd Font|MesloLGS|Cerebro Mono/)
    expect(chrome.overflowY).toBe('auto')
    expect(chrome.scrollbarGutter).toBe(0)
    expect(chrome.nerdWidth).toBeGreaterThan(0)
    expect(chrome.nerdWidth).not.toBe(chrome.menloWidth)
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})
