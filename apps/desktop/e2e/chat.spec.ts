import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
    await page.getByRole('button', { name: 'New Chat tab', exact: true }).click()
    await expect(page.getByTestId('chat-view')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Chat history' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New chat', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Write a message first')
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
    await page.getByRole('textbox', { name: 'Message agent' }).fill('Build a normalized agent chat')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(page.getByTestId('chat-view').getByRole('status')).toContainText('Ready')
    await mkdir('/tmp/cerebro-chat-evidence', { recursive: true })
    await page.screenshot({ path: '/tmp/cerebro-pane-session-evidence/chat.png' })
    await page.reload()
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await page.getByRole('textbox', { name: 'Message agent' }).fill('approval')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Decline', exact: true }).click()
    await expect(page.getByTestId('chat-transcript')).toContainText('Permission resolved.')
    await page.getByRole('textbox', { name: 'Message agent' }).fill('question')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByRole('radio', { name: 'Blue', exact: true }).check()
    await page.getByRole('button', { name: 'Submit answer', exact: true }).click()
    await expect(page.getByTestId('chat-transcript')).toContainText('Answer received.')
    await page.getByRole('textbox', { name: 'Message agent' }).fill('slow')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop agent' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Stop agent' })).toBeVisible()
    await page.getByRole('button', { name: 'Stop agent' }).click()
    await expect(page.getByTestId('chat-view').getByRole('status')).toContainText('interrupted')
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
