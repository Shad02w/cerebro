import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

const artifactsDir = process.env.CEREBRO_E2E_ARTIFACTS ?? join(tmpdir(), 'cerebro-e2e-artifacts')
const executable = resolve(__dirname, '../../../packages/mux/src/agents/fixtures/fake-harness.cjs')

test.use({
  agentEnvironment: {
    CEREBRO_CODEX_PATH: executable,
    CEREBRO_CLAUDE_PATH: executable,
    CEREBRO_PI_PATH: executable
  }
})

async function openAgent(page: Page, directory: string): Promise<void> {
  const project = await page.evaluate(
    (folder) => window.cerebro.createProjectFromDirectory(folder),
    directory
  )
  await page.reload()
  const projectRow = page.getByTestId(/project-row-/).first()
  await expect(projectRow).toBeVisible()
  if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
  await page.locator(`button[data-workspace-id="${project.workspaces[0].id}"]`).click()
  await page.getByRole('button', { name: /^New Agent tab/ }).click()
  await expect(page.getByTestId('chat-composer-shell')).toBeVisible()
}

async function setVim(page: Page, on: boolean, start?: 'Insert' | 'Normal'): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByTestId('settings-composer-vim').click()
  await page.getByRole('option', { name: on ? 'On' : 'Off', exact: true }).click()
  if (start) {
    await page.getByTestId('settings-composer-vim-mode').click()
    await page.getByRole('option', { name: start, exact: true }).click()
    await expect(page.getByTestId('settings-composer-vim-mode')).toHaveText(start)
  }
  await expect(page.getByTestId('settings-composer-vim')).toHaveText(on ? 'On' : 'Off')
  await page.getByRole('button', { name: 'Back' }).click()
}

test('composer vim mode is off by default and settings control it', async ({ page }) => {
  await mkdir(artifactsDir, { recursive: true })
  const settings = await page.evaluate(() => window.cerebro.getSettings())
  expect(settings.composerVim).toBe(false)
  expect(settings.composerVimMode).toBe('insert')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const toggle = page.getByTestId('settings-composer-vim')
  const start = page.getByTestId('settings-composer-vim-mode')
  await expect(toggle).toHaveText('Off')
  await expect(start).toHaveText('Insert')
  await toggle.click()
  await page.getByRole('option', { name: 'On', exact: true }).click()
  await expect(toggle).toHaveText('On')
  await start.click()
  await page.getByRole('option', { name: 'Normal', exact: true }).click()
  await expect(start).toHaveText('Normal')
  await page.screenshot({ path: join(artifactsDir, 'settings-vim.png') })
  const saved = await page.evaluate(() => window.cerebro.getSettings())
  expect(saved.composerVim).toBe(true)
  expect(saved.composerVimMode).toBe('normal')

  const error = await page.evaluate(async () => {
    try {
      await window.cerebro.setSettings({ composerVimMode: 'visual' as never })
      return ''
    } catch (err) {
      return String(err)
    }
  })
  expect(error).toContain('Unknown composer vim mode')
})

test('composer vim mode edits modally and keeps Enter and @ tags to insert mode', async ({
  page,
  electronApp
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-composer-vim-'))
  try {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1250, 900)
    )
    await openAgent(page, directory)
    const composer = page.getByRole('textbox', { name: 'Message agent' })
    const mode = page.getByTestId('composer-vim-mode')

    // Off: no indicator, ordinary typing.
    await expect(mode).toHaveCount(0)
    await composer.click()
    await page.keyboard.type('plain')
    await expect(composer).toHaveAttribute('data-composer-text', 'plain')
    await expect(mode).toHaveCount(0)

    // On, starting in insert.
    await setVim(page, true)
    await expect(mode).toHaveText('I')
    await expect(mode).toHaveAttribute('data-mode', 'insert')
    await page.screenshot({ path: join(artifactsDir, 'vim-insert.png') })

    await composer.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' text')
    await expect(composer).toHaveAttribute('data-composer-text', 'plain text')

    // Escape: normal mode, keys are commands and never insert.
    await page.keyboard.press('Escape')
    await expect(mode).toHaveText('N')
    await expect(mode).toHaveAttribute('data-mode', 'normal')
    await page.screenshot({ path: join(artifactsDir, 'vim-normal.png') })
    await page.keyboard.type('0x')
    await expect(composer).toHaveAttribute('data-composer-text', 'lain text')
    await page.keyboard.type('@')
    await expect(page.getByTestId('composer-add-menu')).toHaveCount(0)
    await expect(composer).toHaveAttribute('data-composer-text', 'lain text')

    // Enter does not send from normal mode.
    await page.keyboard.press('Enter')
    await expect(composer).toHaveAttribute('data-composer-text', 'lain text')
    await expect(page.getByTestId('chat-empty-hero')).toBeVisible()

    // Visual mode has its own indicator.
    await page.keyboard.type('v')
    await expect(mode).toHaveText('V')
    await expect(mode).toHaveAttribute('data-mode', 'visual')
    await page.keyboard.type('ll')
    await page.screenshot({ path: join(artifactsDir, 'vim-visual.png') })
    await page.keyboard.press('Escape')
    await expect(mode).toHaveText('N')

    // Insert again: @ autocomplete works.
    await page.keyboard.type('A')
    await expect(mode).toHaveText('I')
    await page.keyboard.type(' @')
    await expect(page.getByTestId('composer-add-menu')).toBeVisible()
    await page.screenshot({ path: join(artifactsDir, 'vim-insert-autocomplete.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('composer-add-menu')).toHaveCount(0)
    await expect(mode).toHaveText('I')

    // Turning it off removes the indicator and the modal behaviour.
    await setVim(page, false)
    await expect(mode).toHaveCount(0)
    await composer.click()
    await page.keyboard.type('z')
    await expect(composer).toHaveAttribute('data-composer-text', /z$/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('composer vim mode can start in normal mode', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-composer-vim-start-'))
  try {
    await setVim(page, true, 'Normal')
    await openAgent(page, directory)
    const composer = page.getByRole('textbox', { name: 'Message agent' })
    const mode = page.getByTestId('composer-vim-mode')
    await expect(mode).toHaveText('N')
    await composer.click()
    await page.keyboard.type('$0')
    await expect(composer).toHaveAttribute('data-composer-text', '')
    await page.keyboard.type('i')
    await expect(mode).toHaveText('I')
    await page.keyboard.type('hello')
    await expect(composer).toHaveAttribute('data-composer-text', 'hello')
    await page.screenshot({ path: join(artifactsDir, 'vim-start-normal.png') })

    // Sending returns to the starting mode.
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('chat-empty-hero')).toBeHidden()
    await expect(mode).toHaveText('N')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
