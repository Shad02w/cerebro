import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect } from './fixtures'

const executable = resolve(__dirname, '../../../packages/mux/src/agents/fixtures/fake-harness.cjs')
test.use({
  agentEnvironment: {
    CEREBRO_CLAUDE_PATH: executable,
    CEREBRO_CODEX_PATH: executable,
    CEREBRO_PI_PATH: executable
  }
})

for (const harness of ['Claude Code', 'Codex', 'Pi']) {
  test(`${harness} tabs fit their content up to 192px and retain the session icon after reload`, async ({
    page,
    electronApp
  }) => {
    const directory = await mkdtemp(join(tmpdir(), 'cerebro-tab-width-'))
    try {
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1250, 900)
      )
      const project = await page.evaluate(
        (directory) => window.cerebro.createProjectFromDirectory(directory),
        directory
      )
      const workspaceId = project.workspaces[0].id
      await page.evaluate(async (workspaceId) => {
        await window.cerebro.layoutCommand({
          target: 'tab',
          action: 'create',
          workspaceId,
          kind: 'changes'
        })
        for (let index = 0; index < 2; index++) {
          await window.cerebro.layoutCommand({
            target: 'tab',
            action: 'create',
            workspaceId,
            kind: 'chat'
          })
        }
      }, workspaceId)
      await page.reload()
      await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
      const tabs = page.getByTestId('chat-tab')
      await expect(tabs).toHaveCount(2)
      await expect(tabs.getByTestId('chat-tab-agent-icon')).toHaveCount(0)
      const emptyWidth = (await tabs.first().boundingBox())!.width
      expect(emptyWidth).toBeLessThan(100)
      const changesTab = page.getByTestId('changes-tab')
      await expect(changesTab).toBeVisible()
      const changesWidth = (await changesTab.boundingBox())!.width
      expect(changesWidth).toBeGreaterThan(emptyWidth)
      expect(changesWidth).toBeLessThan(140)
      const chat = page.locator('[data-pane-kind="chat"]:visible')
      await expect(chat.getByTestId('chat-model-picker')).toContainText('Test Model')
      await chat.getByTestId('chat-model-picker').click()
      await page
        .getByTestId('model-picker')
        .getByRole('button', { name: harness, exact: true })
        .click()
      await page
        .getByTestId('model-picker')
        .getByRole('option', { name: new RegExp(`^Test Model.*${harness}`) })
        .click()
      await expect(tabs.getByTestId('chat-tab-agent-icon')).toHaveCount(0)
      const prompt = 'what is the weather today in toronto and for the rest of this week'
      await chat.getByRole('textbox', { name: 'Message agent' }).fill(prompt)
      await chat.getByRole('button', { name: 'Send message', exact: true }).click()
      await expect(tabs.nth(1)).toContainText(prompt)
      await expect(chat.getByTestId('chat-transcript')).toContainText('Adapter connected.')
      await expect(tabs.first().getByTestId('chat-tab-agent-icon')).toHaveCount(0)
      await expect(tabs.nth(1).getByRole('img', { name: harness })).toBeVisible()
      await page.reload()
      await expect(tabs.nth(1).getByRole('img', { name: harness })).toBeVisible()
      expect((await tabs.first().boundingBox())!.width).toBe(emptyWidth)
      await expect(tabs.nth(1)).toHaveCSS('width', '192px')
      const label = tabs.nth(1).locator('span.truncate')
      expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true
      )
      await expect(tabs.nth(1).getByTestId('content-tab-close')).toBeVisible()
      await mkdir('/tmp/cerebro-tab-width-evidence', { recursive: true })
      await page.mouse.move(1100, 400)
      await page.screenshot({ path: `/tmp/cerebro-tab-width-evidence/${harness}-compact-tabs.png` })
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(750, 700)
      )
      expect((await tabs.first().boundingBox())!.width).toBe(emptyWidth)
      expect((await changesTab.boundingBox())!.width).toBe(changesWidth)
      await expect(tabs.nth(1)).toHaveCSS('width', '192px')
      await tabs.first().click()
      await expect(chat.getByTestId('chat-empty-hero')).toContainText(
        'What would you like to build?'
      )
      await page.screenshot({
        path: `/tmp/cerebro-tab-width-evidence/${harness}-empty-chat-narrow.png`
      })
      const close = tabs.first().getByRole('button', { name: /^Close Agent/ })
      await chat.getByRole('textbox', { name: 'Message agent' }).focus()
      await page.mouse.move(700, 400)
      await expect(close).toHaveCSS('opacity', '0')
      const beforeHover = await tabs.first().boundingBox()
      await tabs.first().hover()
      await expect(close).toHaveCSS('opacity', '1')
      expect(await tabs.first().boundingBox()).toEqual(beforeHover)
      expect(await close.evaluate((button) => button.closest('[role="tab"]'))).toBeNull()
      const target = await close.boundingBox()
      expect(target!.width).toBeGreaterThanOrEqual(24)
      expect(target!.height).toBeGreaterThanOrEqual(24)
      await page.screenshot({ path: `/tmp/cerebro-tab-width-evidence/${harness}-close-hover.png` })
      await page.mouse.move(700, 400)
      await expect(close).toHaveCSS('opacity', '0')
      await tabs.first().getByRole('tab').focus()
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      await expect(close).toHaveCSS('opacity', '1')
      await expect(close).toHaveCSS('outline-style', 'solid')
      await page.screenshot({ path: `/tmp/cerebro-tab-width-evidence/${harness}-close-focus.png` })
      await page.keyboard.press('Enter')
      await expect(tabs).toHaveCount(1)
      await expect(tabs.first().getByRole('tab')).toBeFocused()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Space')
      await expect(tabs).toHaveCount(0)
      await expect(changesTab.getByRole('tab')).toBeFocused()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
