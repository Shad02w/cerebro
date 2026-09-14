import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { JSHandle } from '@playwright/test'
import { test, expect, stopMux } from './fixtures'
const executable = resolve(__dirname, '../../../packages/mux/src/agents/fixtures/fake-harness.cjs')
test.use({
  agentEnvironment: {
    CEREBRO_CODEX_PATH: executable,
    CEREBRO_CLAUDE_PATH: executable,
    CEREBRO_PI_PATH: executable
  }
})

test('chat works through native adapters, survives reload, handles requests, and persists model favorites', async ({
  page,
  electronApp
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-e2e-'))
  try {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1250, 900)
    )
    const project = await page.evaluate(
      (directory) => window.cerebro.createProjectFromDirectory(directory),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.reload()
    const projectRow = page.getByTestId(/project-row-/).first()
    await expect(projectRow).toBeVisible()
    if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    await page.getByRole('button', { name: /^New Chat tab/ }).click()
    await expect(page.getByTestId('chat-view')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Access mode' })).toHaveValue('full')
    await expect(page.getByRole('combobox', { name: 'Chat history' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New chat', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Write a message first')
    await expect(page.getByTestId('chat-transcript').getByRole('alert')).toContainText(
      'Write a message first'
    )
    await expect(page.getByTestId('chat-composer').getByRole('alert')).toHaveCount(0)
    await page.getByTestId('chat-model-picker').click()
    await expect(
      page.getByTestId('model-picker').getByRole('button', { name: 'All', exact: true })
    ).toHaveCount(0)
    await expect(page.getByTestId('model-picker').getByRole('combobox')).toHaveCount(0)
    for (const [name, harness] of [
      ['Claude Code', 'claude'],
      ['Codex', 'codex'],
      ['Pi', 'pi']
    ]) {
      const button = page.getByTestId('model-picker').getByRole('button', { name, exact: true })
      await expect(button).toHaveText('')
      await expect(button.locator(`[data-harness-icon="${harness}"]`)).toBeVisible()
      await expect(button.locator(`[data-harness-icon="${harness}"]`)).toHaveCSS(
        'mask-image',
        /url\(/
      )
    }
    await page.getByRole('button', { name: 'Codex', exact: true }).click()
    await expect(
      page.getByTestId('model-picker').getByRole('button', { name: /^Test Model.*Claude Code/ })
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Favorite Test Model via Codex', exact: true }).click()
    await expect(page.getByTestId('model-picker')).toBeVisible()
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Unfavorite Test Model via Codex', exact: true })
    ).toBeVisible()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Test Model.*Codex/ })
      .click()
    const userText = 'Build a normalized agent chat\nPreserve spacing:  café 🚀'
    await page.getByRole('textbox', { name: 'Message agent' }).fill(userText)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(page.getByTestId('chat-view').getByRole('status')).toContainText('Ready')
    await expect(page.getByTestId('chat-transcript').getByRole('status')).toContainText(
      'Ready · Native session saved'
    )
    await expect(page.getByRole('separator', { name: 'End of response' })).toHaveCount(1)
    await mkdir('/tmp/cerebro-chat-evidence', { recursive: true })
    const userMessage = page.getByTestId('chat-user-message').first()
    const copyButton = userMessage.getByRole('button', { name: 'Copy message', exact: true })
    const previousClipboard = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    try {
      await copyButton.click()
      await expect(page.getByTestId('chat-copy-toast')).toContainText(
        'Message copied to clipboard.'
      )
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(userText)
      const bubbleBox = await userMessage.locator(':scope > div').first().boundingBox()
      const copyBox = await copyButton.boundingBox()
      expect(copyBox!.y).toBeGreaterThanOrEqual(bubbleBox!.y + bubbleBox!.height)
      await page.screenshot({ path: '/tmp/cerebro-chat-evidence/user-copy-success.png' })
      await page.getByRole('button', { name: 'Dismiss notification' }).click()
      await expect(page.getByTestId('chat-copy-toast')).toHaveCount(0)
      await copyButton.click()
      await expect(page.getByTestId('chat-copy-toast')).toBeVisible()
      await page.evaluate(() => {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          configurable: true,
          value: async () => {
            throw new Error('Clipboard unavailable')
          }
        })
      })
      await copyButton.click()
      await expect(userMessage.getByRole('alert')).toHaveText('Could not copy message.')
      await expect(page.getByTestId('chat-copy-toast')).toHaveCount(0)
      await page.screenshot({ path: '/tmp/cerebro-chat-evidence/user-copy-error.png' })
    } finally {
      await page.evaluate(() => Reflect.deleteProperty(navigator.clipboard, 'writeText'))
      await electronApp.evaluate(
        ({ clipboard }, text) => clipboard.writeText(text),
        previousClipboard
      )
    }
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/response-ended.png' })
    await page.screenshot({ path: '/tmp/cerebro-pane-session-evidence/chat.png' })
    await page.reload()
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await page.getByRole('combobox', { name: 'Access mode' }).selectOption('edit')
    await page.getByRole('textbox', { name: 'Message agent' }).fill('approval')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Decline', exact: true }).click()
    await expect(page.getByTestId('chat-transcript')).toContainText('Permission resolved.')
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Access mode' })).toHaveValue('edit')
    await page.getByRole('combobox', { name: 'Access mode' }).selectOption('read')
    await page.getByRole('textbox', { name: 'Message agent' }).fill('question')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByRole('radio', { name: 'Blue', exact: true }).check()
    await page.getByRole('button', { name: 'Submit answer', exact: true }).click()
    await expect(page.getByTestId('chat-transcript')).toContainText('Answer received.')
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Access mode' })).toHaveValue('read')
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/access-read.png' })
    await page.getByRole('textbox', { name: 'Message agent' }).fill('slow')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop agent' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Stop agent' })).toBeVisible()
    const working = page.getByTestId('chat-transcript').getByRole('status')
    await expect(working).toHaveText('Working…')
    await expect(page.getByRole('separator', { name: 'End of response' })).toHaveCount(3)
    await expect(page.getByTestId('chat-view').getByRole('status')).toHaveCount(1)
    const workingText = working.locator('span')
    await expect(workingText).toHaveCSS('animation-name', 'chat-working-shimmer')
    await working.scrollIntoViewIfNeeded()
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/working-shimmer.png' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(workingText).toHaveCSS('animation-name', 'none')
    await expect(workingText).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)')
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/working-reduced-motion.png' })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.getByRole('button', { name: 'Stop agent' }).click()
    await expect(working).not.toContainText('Working…')
    await expect(page.getByRole('separator', { name: 'End of response' })).toHaveCount(4)
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/response-interrupted.png' })
    await expect(page.getByTestId('chat-view').getByRole('status')).toContainText('interrupted')
    const chatTranscript = page.getByTestId('chat-transcript')
    const composer = page.getByTestId('chat-composer')
    await expect(chatTranscript.getByRole('alert')).toContainText('interrupted')
    await expect(composer.getByRole('status')).toHaveCount(0)
    await expect(composer.getByRole('alert')).toHaveCount(0)
    const clearance = async (): Promise<number> => {
      const errorBox = await chatTranscript.getByRole('alert').boundingBox()
      const composerBox = await composer.boundingBox()
      return composerBox!.y - (errorBox!.y + errorBox!.height)
    }
    await expect.poll(clearance).toBeGreaterThanOrEqual(23)
    const expectAlignedComposer = async (): Promise<void> => {
      const contentBox = await chatTranscript.locator(':scope > div').boundingBox()
      const inputBox = await composer.locator('form').boundingBox()
      expect(Math.abs(contentBox!.x - inputBox!.x)).toBeLessThan(1)
      expect(Math.abs(contentBox!.width - inputBox!.width)).toBeLessThan(1)
    }
    await expectAlignedComposer()
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(850, 900)
    )
    await expect(async () => expectAlignedComposer()).toPass()
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/composer-width-narrow.png' })
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1250, 900)
    )
    await expect(async () => expectAlignedComposer()).toPass()
    const transcriptBox = await chatTranscript.boundingBox()
    const composerBox = await composer.boundingBox()
    expect(transcriptBox!.y + transcriptBox!.height).toBeGreaterThan(
      composerBox!.y + composerBox!.height - 1
    )
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/floating-composer-bottom.png' })
    // Resizing the input must update the transcript's reserved space without hiding its end.
    await page.getByRole('textbox', { name: 'Message agent' }).evaluate((element) => {
      element.style.height = '190px'
    })
    await expect.poll(clearance).toBeGreaterThanOrEqual(23)
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/floating-composer-resized.png' })
    const floatingTop = (await composer.boundingBox())!.y
    await chatTranscript.hover({ position: { x: 20, y: 60 } })
    await page.mouse.wheel(0, -200)
    await expect
      .poll(() =>
        chatTranscript.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)
      )
      .toBeGreaterThan(100)
    expect((await composer.boundingBox())!.y).toBe(floatingTop)
    await expect(composer.locator('form')).toHaveCSS('backdrop-filter', 'none')
    await expect(page.getByTestId('chat-list-blur')).toHaveCount(0)
    const fade = page.getByTestId('chat-list-fade')
    await expect(fade).toHaveCSS('pointer-events', 'none')
    const fadeBox = await fade.boundingBox()
    const formBox = await composer.locator('form').boundingBox()
    expect(fadeBox!.height).toBeLessThanOrEqual(48)
    expect(fadeBox!.y).toBe(floatingTop)
    expect(fadeBox!.y + fadeBox!.height).toBeCloseTo(formBox!.y, 0)
    // The dock spans the whole transcript so no text peeks out beside the form.
    expect(fadeBox!.x).toBeLessThanOrEqual(transcriptBox!.x)
    expect(fadeBox!.width).toBeGreaterThanOrEqual(formBox!.width + 40)
    expect(fadeBox!.x + fadeBox!.width).toBeLessThanOrEqual(
      transcriptBox!.x + transcriptBox!.width + 1
    )
    expect(formBox!.y + formBox!.height).toBeLessThanOrEqual(
      transcriptBox!.y + transcriptBox!.height
    )
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/floating-composer-scrolled.png' })
    await page.getByRole('textbox', { name: 'Message agent' }).evaluate((element) => {
      element.style.removeProperty('height')
    })
    const home = await electronApp.evaluate(() => process.env.CEREBRO_HOME!)
    const paneId = Number(
      await page.locator('[data-pane-kind="chat"]:visible').getAttribute('data-pane-id')
    )
    await stopMux(home)
    await page.evaluate(
      ({ workspaceId, paneId }) =>
        window.cerebro.layoutCommand({ target: 'pane', action: 'focus', workspaceId, paneId }),
      { workspaceId, paneId }
    )
    await page.reload()
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await page.getByTestId('chat-model-picker').click()
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Unfavorite Test Model via Codex', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Codex', exact: true }).click()
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/model-picker-icons.png' })
    const models = page.locator('.model-picker-list')
    // Constrain the list to exercise overflow with the two native fixture models.
    await models.evaluate((element) => {
      element.style.maxHeight = '96px'
    })
    expect(
      await models.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').width)
    ).toBe('6px')
    expect(
      await models.evaluate(
        (element) => getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor
      )
    ).toBe('rgba(0, 0, 0, 0)')
    await models.hover()
    await page.mouse.wheel(0, 100)
    await expect.poll(() => models.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/model-picker-scrollbar.png' })
    await models.evaluate((element) => element.style.removeProperty('max-height'))
    await page.keyboard.press('Escape')
    const transcript = page.getByTestId('chat-transcript')
    expect(
      await transcript.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').width)
    ).toBe('6px')
    expect(
      await transcript.evaluate(
        (element) => getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor
      )
    ).toBe('rgba(0, 0, 0, 0)')
    await transcript.hover()
    await page.mouse.wheel(0, -200)
    await expect
      .poll(() =>
        transcript.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop
        )
      )
      .toBeGreaterThan(100)
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/chat-scrollbar.png' })
    await page.getByTestId('new-terminal-tab').click()
    await page.getByTestId('pane-menu-right').hover()
    await page.getByTestId('add-pane-right-chat').click()
    const panes = page.locator('[data-pane-kind="chat"]:visible')
    await expect(panes).toHaveCount(2)
    await expect(panes.nth(0).getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(panes.nth(1).getByTestId('chat-transcript')).toContainText(
      'What would you like to build?'
    )
    await panes
      .nth(1)
      .getByRole('textbox', { name: 'Message agent' })
      .fill('Independent pane session')
    await panes.nth(1).getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(panes.nth(1).getByRole('status')).toContainText('Ready')
    await expect(panes.nth(0).getByTestId('chat-transcript')).not.toContainText(
      'Independent pane session'
    )
    await page.screenshot({ path: '/tmp/cerebro-pane-session-evidence/split-chat.png' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Claude and Pi keep separate chat sessions, with a mixed Terminal pane', async ({ page }) => {
  const chat = page.locator('[data-pane-kind="chat"]:visible')
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-harnesses-'))
  try {
    const project = await page.evaluate(
      (directory) => window.cerebro.createProjectFromDirectory(directory),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.evaluate(
      (workspaceId) =>
        window.cerebro.layoutCommand({
          target: 'tab',
          action: 'create',
          workspaceId,
          kind: 'chat'
        }),
      workspaceId
    )
    await page.reload()
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    await expect(chat.getByTestId('chat-model-picker')).toBeVisible()
    await expect(chat.getByTestId('chat-model-picker')).toContainText('Claude Code')
    await chat.getByRole('textbox', { name: 'Message agent' }).fill('hello Claude')
    await chat.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(chat.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(chat.getByTestId('chat-view').getByRole('status')).toContainText('Ready')
    await chat.getByTestId('chat-model-picker').click()
    await page.getByTestId('model-picker').getByRole('button', { name: 'Pi', exact: true }).click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Test Model.*Pi/ })
      .click()
    await expect(page.getByRole('alert')).toContainText('Open a new Chat tab or pane to use Pi.')
    await expect(chat.getByTestId('chat-model-picker')).toContainText('Claude Code')
    await expect(chat.getByTestId('chat-transcript')).toContainText('hello Claude')
    await page.getByTestId('new-terminal-tab').click()
    await page.getByTestId('open-chat-tab').click()
    await chat.getByTestId('chat-model-picker').click()
    await page.getByTestId('model-picker').getByRole('button', { name: 'Pi', exact: true }).click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Test Model.*Pi/ })
      .click()
    await expect(chat.getByTestId('chat-model-picker')).toContainText('Pi')
    await chat.getByRole('textbox', { name: 'Message agent' }).fill('hello Pi')
    await chat.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(chat.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(chat.getByTestId('chat-view').getByRole('status')).toContainText('Ready')
    await page.getByTestId('new-terminal-tab').click()
    await page.getByTestId('pane-menu-right').hover()
    await page.getByTestId('add-pane-right-terminal').press('Enter')
    await expect(page.locator('[data-pane-kind="chat"]:visible')).toHaveCount(1)
    await expect(page.locator('[data-pane-kind="terminal"]:visible')).toHaveCount(1)
    await expect(page.locator('[data-terminal-status="running"]')).toBeVisible()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.describe('unavailable native installations', () => {
  test.use({
    agentEnvironment: {
      CEREBRO_CODEX_PATH: '/nonexistent/cerebro-codex',
      CEREBRO_CLAUDE_PATH: '/nonexistent/cerebro-claude',
      CEREBRO_PI_PATH: '/nonexistent/cerebro-pi'
    }
  })
  test('shows actionable setup errors and keeps Send available', async ({ page, electronApp }) => {
    const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-missing-'))
    try {
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1250, 900)
      )
      const project = await page.evaluate(
        (directory) => window.cerebro.createProjectFromDirectory(directory),
        directory
      )
      await page.evaluate(
        (workspaceId) =>
          window.cerebro.layoutCommand({
            target: 'tab',
            action: 'create',
            workspaceId,
            kind: 'chat'
          }),
        project.workspaces[0].id
      )
      await page.reload()
      await page.locator(`button[data-workspace-id="${project.workspaces[0].id}"]`).click()
      await page.getByRole('textbox', { name: 'Message agent' }).fill('hello')
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('Choose an available model')
      await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled()
      await page.getByTestId('chat-model-picker').click()
      await expect(page.getByTestId('model-picker')).toContainText('Unavailable')
      await page.getByText('Claude Code setup details', { exact: true }).click()
      await expect(page.getByTestId('model-picker')).toContainText('not installed or not on PATH')
      await mkdir('/tmp/cerebro-chat-evidence', { recursive: true })
      await page.screenshot({ path: '/tmp/cerebro-chat-evidence/setup.png' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

test('Mod+N opens independent Chat tabs from a workspace row, composer, and terminal', async ({
  page
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-shortcut-'))
  const chord = process.platform === 'darwin' ? 'Meta+n' : 'Control+n'
  try {
    const project = await page.evaluate(
      (directory) => window.cerebro.createProjectFromDirectory(directory),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.reload()
    const projectRow = page.getByTestId(/project-row-/).first()
    await expect(projectRow).toBeVisible()
    if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
    const row = page.locator(`button[data-workspace-id="${workspaceId}"]`)
    await row.click()
    await expect(
      page.getByTestId('workspace-empty-state').locator('[data-hotkey="Mod+N"]')
    ).toBeVisible()
    await row.focus()
    await page.keyboard.press(chord)
    await expect(page.getByTestId('chat-tab')).toHaveCount(1)
    const chat = page.locator('[data-pane-kind="chat"]:visible')
    const firstPane = await chat.getAttribute('data-pane-id')
    await chat.getByRole('textbox', { name: 'Message agent' }).fill('Keep this draft')
    await page.keyboard.press(chord)
    await expect(page.getByTestId('chat-tab')).toHaveCount(2)
    await expect(chat).not.toHaveAttribute('data-pane-id', firstPane!)
    await expect(chat.getByRole('textbox', { name: 'Message agent' })).toHaveValue('')
    await page.getByTestId('chat-tab').first().click()
    await expect(chat.getByRole('textbox', { name: 'Message agent' })).toHaveValue(
      'Keep this draft'
    )
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+t' : 'Control+t')
    const terminal = page.locator('[data-terminal-active="true"] .xterm-helper-textarea')
    await expect(terminal).toBeFocused()
    await page.keyboard.press(chord)
    await expect(page.getByTestId('chat-tab')).toHaveCount(3)
    await expect(chat.getByTestId('chat-transcript')).toContainText('What would you like to build?')
    await page.getByTestId('new-terminal-tab').click()
    await expect(page.getByTestId('open-chat-tab').locator('[data-hotkey="Mod+N"]')).toBeVisible()
    await mkdir('/tmp/cerebro-pane-session-evidence', { recursive: true })
    await expect(page.getByTestId('add-tab-menu').locator('[data-testid^="open-"]')).toHaveText([
      /Chat/,
      /Terminal/,
      /Changes/
    ])
    await expect(page.getByTestId('add-tab-menu')).toHaveCSS('opacity', '1')
    await page.screenshot({ path: '/tmp/cerebro-pane-session-evidence/chat-first.png' })
    await page.getByTestId('pane-menu-right').hover()
    await expect(page.locator('[data-testid^="add-pane-right-"]')).toHaveText([
      'Chat',
      'Terminal',
      'Changes'
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

test('image attachments use atomic chips, reach the harness, render in the transcript, and respect model modalities', async ({
  page,
  electronApp
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-images-'))
  try {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1250, 900)
    )
    const project = await page.evaluate(
      (directory) => window.cerebro.createProjectFromDirectory(directory),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.evaluate(
      (workspaceId) =>
        window.cerebro.layoutCommand({
          target: 'tab',
          action: 'create',
          workspaceId,
          kind: 'chat'
        }),
      workspaceId
    )
    await page.reload()
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    const chat = page.locator('[data-pane-kind="chat"]:visible')
    const textbox = chat.getByRole('textbox', { name: 'Message agent' })
    const form = chat.getByTestId('chat-composer').locator('form')
    const attachments = chat.getByTestId('chat-attachment')
    const caret = (): Promise<number> =>
      textbox.evaluate((element: HTMLTextAreaElement) => element.selectionStart)
    const transfer = (name: string): Promise<JSHandle<DataTransfer>> =>
      page.evaluateHandle(
        ({ name, png }) => {
          const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0))
          const transfer = new DataTransfer()
          transfer.items.add(new File([bytes], name, { type: 'image/png' }))
          return transfer
        },
        { name, png }
      )
    const paste = async (name: string): Promise<void> => {
      const clipboardData = await transfer(name)
      await textbox.evaluate(
        (element, clipboardData) =>
          element.dispatchEvent(
            new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
          ),
        clipboardData
      )
    }
    await chat.getByTestId('chat-model-picker').click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: 'Codex', exact: true })
      .click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Test Model.*Codex/ })
      .click()
    await textbox.fill('attachments here')
    await textbox.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(11, 11))
    const dropped = await transfer('first.png')
    await form.dispatchEvent('dragover', { dataTransfer: dropped })
    await expect(chat.getByTestId('chat-drop-overlay')).toBeVisible()
    await form.dispatchEvent('drop', { dataTransfer: dropped })
    await expect(chat.getByTestId('chat-drop-overlay')).toHaveCount(0)
    await expect(attachments).toHaveCount(1)
    await expect(attachments.first()).toContainText('first.png')
    await expect(textbox).toHaveValue('attachments [Image #1] here')
    expect(await caret()).toBe(22)
    await paste('second.png')
    await expect(attachments).toHaveCount(2)
    await expect(textbox).toHaveValue('attachments [Image #1] [Image #2] here')
    expect(await caret()).toBe(33)
    await mkdir('/tmp/cerebro-chat-evidence', { recursive: true })
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/attachments-composer.png' })
    // The caret never rests inside a chip: one left arrow jumps over "[Image #2]".
    await textbox.press('ArrowLeft')
    expect(await caret()).toBe(23)
    // Backspace at a chip edge removes the whole chip and its attachment.
    await textbox.press('End')
    for (let i = 0; i < 5; i++) await textbox.press('ArrowLeft')
    expect(await caret()).toBe(33)
    await textbox.press('Backspace')
    await expect(attachments).toHaveCount(1)
    await expect(textbox).toHaveValue('attachments [Image #1] here')
    expect(await caret()).toBe(23)
    // Typing over part of a chip removes it entirely.
    await textbox.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(12, 12))
    await textbox.press('Shift+ArrowRight')
    await textbox.press('Shift+ArrowRight')
    await textbox.type('x')
    await expect(attachments).toHaveCount(0)
    await expect(textbox).toHaveValue('attachments xhere')
    // A hand-typed marker is plain text, not a chip.
    await textbox.fill('attachments here [Image #1]')
    await expect(attachments).toHaveCount(0)
    // The attach button adds a chip at the end and later removals renumber the rest.
    await chat.getByTestId('chat-image-input').setInputFiles({
      name: 'third.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64')
    })
    await expect(attachments).toHaveCount(1)
    await expect(textbox).toHaveValue('attachments here [Image #1] [Image #1] ')
    await paste('fourth.png')
    await expect(attachments).toHaveCount(2)
    await expect(textbox).toHaveValue('attachments here [Image #1] [Image #1] [Image #2] ')
    await chat.getByRole('button', { name: 'Remove image 1', exact: true }).click()
    await expect(attachments).toHaveCount(1)
    await expect(attachments.first()).toContainText('fourth.png')
    await expect(attachments.first()).toContainText('#1')
    await expect(textbox).toHaveValue('attachments here [Image #1] [Image #1] ')
    // Reload keeps plain text and drops chips with their attachments.
    await page.reload()
    await expect(textbox).toHaveValue('attachments here [Image #1]')
    await expect(attachments).toHaveCount(0)
    await paste('sent.png')
    await expect(textbox).toHaveValue('attachments here [Image #1] [Image #1] ')
    // The reload reset the picker to the default harness; send through Codex again.
    await chat.getByTestId('chat-model-picker').click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: 'Codex', exact: true })
      .click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Test Model.*Codex/ })
      .click()
    await chat.getByRole('button', { name: 'Send message', exact: true }).click()
    const transcript = chat.getByTestId('chat-transcript')
    await expect(transcript).toContainText('"type":"localImage"')
    await expect(transcript).toContainText('"placeholder":"[Image #1]"')
    await expect(chat.getByTestId('chat-view').getByRole('status')).toContainText('Ready')
    await expect(textbox).toHaveValue('')
    await expect(attachments).toHaveCount(0)
    const message = chat.getByTestId('chat-user-message').first()
    await expect(message.getByRole('img', { name: 'sent.png' })).toBeVisible()
    // The transcript matches markers by text, so the hand-typed look-alike also opens image 1.
    await expect(message.getByTestId('chat-image-chip')).toHaveCount(2)
    await expect(message).toContainText('[Image #1] [Image #1]')
    await message.getByTestId('chat-image-chip').first().click()
    await expect(page.getByTestId('chat-image-preview')).toBeVisible()
    await expect(
      page.getByTestId('chat-image-preview').getByRole('img', { name: 'sent.png' })
    ).toBeVisible()
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/attachments-preview.png' })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('chat-image-preview')).toHaveCount(0)
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/attachments-transcript.png' })
    await page.reload()
    await expect(
      chat.getByTestId('chat-user-message').first().getByRole('img', { name: 'sent.png' })
    ).toBeVisible()
    // A text-only model refuses images with an actionable error instead of dropping them.
    await chat.getByTestId('chat-model-picker').click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Second Model.*Codex/ })
      .click()
    await paste('refused.png')
    await expect(chat.getByRole('alert')).toContainText('Second Model does not accept images')
    await expect(attachments).toHaveCount(0)
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/attachments-text-only.png' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('forking a completed response branches it into a new tab or a new pane, leaving the source untouched', async ({
  page,
  electronApp
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-fork-'))
  try {
    const project = await page.evaluate(
      (directory) => window.cerebro.createProjectFromDirectory(directory),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.evaluate(
      (workspaceId) =>
        window.cerebro.layoutCommand({
          target: 'tab',
          action: 'create',
          workspaceId,
          kind: 'chat'
        }),
      workspaceId
    )
    await page.reload()
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    const chat = page.locator('[data-pane-kind="chat"]:visible')
    await chat.getByRole('textbox', { name: 'Message agent' }).fill('hello')
    await chat.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(chat.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(chat.getByTestId('chat-view').getByRole('status')).toContainText('Ready')

    const actions = chat.getByTestId('chat-turn-actions')
    const copyButton = actions.getByRole('button', { name: 'Copy response', exact: true })
    const previousClipboard = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    await copyButton.click()
    await expect(page.getByTestId('chat-turn-copy-toast')).toContainText(
      'Response copied to clipboard.'
    )
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(
      'Adapter connected.'
    )
    await electronApp.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      previousClipboard
    )
    await mkdir('/tmp/cerebro-chat-evidence', { recursive: true })
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/turn-actions.png' })

    await actions.getByTestId('chat-fork-trigger').click()
    await page.getByTestId('chat-fork-new-tab').click()
    await expect(page.getByTestId('chat-tab')).toHaveCount(2)
    await expect(chat.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(chat.getByTestId('chat-transcript')).toContainText('hello')
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/fork-new-tab.png' })

    // The source conversation is untouched by the fork.
    await page.getByTestId('chat-tab').first().click()
    await expect(chat.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(chat.getByRole('status')).toContainText('Ready')

    await actions.getByTestId('chat-fork-trigger').click()
    await page.getByTestId('chat-fork-new-pane').click()
    const panes = page.locator('[data-pane-kind="chat"]:visible')
    await expect(panes).toHaveCount(2)
    await expect(panes.nth(1).getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(panes.nth(1).getByTestId('chat-transcript')).toContainText('hello')
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/fork-new-pane.png' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
