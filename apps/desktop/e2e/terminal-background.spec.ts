import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './fixtures'

for (const renderer of ['auto', 'dom'] as const) {
  test(`terminal bottom edge has no black strip (${renderer})`, async ({
    page,
    electronApp
  }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 806)
    )
    const directory = await mkdtemp(join(tmpdir(), 'cerebro-background-'))
    try {
      await page.evaluate(async (directory) => {
        await window.cerebro.setSettings({ terminalTheme: 'dracula' })
        const project = await window.cerebro.createProjectFromDirectory(directory)
        await window.cerebro.setActiveWorkspace(project.workspaces[0].id)
      }, directory)
      if (renderer === 'dom') {
        await page.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext
          HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
            if (type === 'webgl' || type === 'webgl2') return null
            return Reflect.apply(original, this, [type, ...args])
          } as typeof original
        })
      }
      await page.reload()
      await page.getByTestId('new-terminal-tab').click()
      await page.getByTestId('open-terminal-tab').click()
      const host = page.locator('.terminal-host')
      const screen = host.locator('.xterm-screen')
      await expect(screen).toBeVisible()
      await expect(host).toHaveCSS('background-color', 'rgb(40, 42, 54)')
      if (renderer === 'dom') await expect(host).toHaveAttribute('data-terminal-renderer', 'dom')
      // The fitted grid must stay inside the padded content box on both axes.
      await expect
        .poll(() =>
          host.evaluate((element) => {
            const terminal = element.querySelector('.xterm')!
            const bounds = terminal.getBoundingClientRect()
            const screen = element.querySelector('.xterm-screen')!.getBoundingClientRect()
            const style = getComputedStyle(terminal)
            return (
              screen.bottom <= bounds.bottom - parseFloat(style.paddingBottom) &&
              screen.right <= bounds.right - parseFloat(style.paddingRight)
            )
          })
        )
        .toBe(true)
      // Whole terminal rows leave a remainder below the canvas. The legacy
      // viewport sits behind that gap, but must not paint its default black.
      await expect
        .poll(() =>
          host.evaluate((element) => {
            const terminal = element.querySelector('.xterm')!.getBoundingClientRect()
            const screen = element.querySelector('.xterm-screen')!.getBoundingClientRect()
            return terminal.bottom - screen.bottom
          })
        )
        .toBeGreaterThan(0)
      await page.screenshot({ path: testInfo.outputPath('terminal-background.png') })
      await expect(host.locator('.xterm-viewport')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)'
      )
      // The v6 scrolling surface still owns the theme and scrolling.
      await expect(host.locator('.xterm-scrollable-element')).toHaveCSS(
        'background-color',
        'rgb(40, 42, 54)'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
