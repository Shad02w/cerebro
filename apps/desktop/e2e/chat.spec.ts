import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication, JSHandle, Page } from '@playwright/test'
import { test, expect, stopMux } from './fixtures'
import { ensureArtifactDir } from './artifact-dir'

const execFileAsync = promisify(execFile)
const executable = resolve(__dirname, '../../../packages/mux/src/agents/fixtures/fake-harness.cjs')
const chatEvidenceDir = '/tmp/cerebro-chat-evidence'
const preferredArtifactsDir = '/opt/cursor/artifacts'

async function screenshotChatEvidence(
  page: { screenshot: (options: { path: string }) => Promise<Buffer> },
  name: string
): Promise<void> {
  await page.screenshot({ path: join(chatEvidenceDir, name) })
  const artifacts = await ensureArtifactDir(preferredArtifactsDir)
  await page.screenshot({ path: join(artifacts, name) }).catch(() => undefined)
}

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
    await page.getByRole('button', { name: /^New Agent tab/ }).click()
    await expect(page.getByTestId('chat-view')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Access mode' })).toHaveValue('full')
    await expect(page.getByRole('combobox', { name: 'Chat history' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New chat', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Write a message first')
    await expect(page.getByTestId('chat-composer').getByRole('alert')).toContainText(
      'Write a message first'
    )
    await expect(page.getByTestId('chat-transcript').getByRole('alert')).toHaveCount(0)
    await expect(page.getByTestId('chat-composer')).toHaveAttribute('data-dock', 'center')
    await expect(page.getByTestId('chat-empty-hero')).toBeVisible()
    await expect(page.getByTestId('chat-composer-glow')).toHaveCount(0)
    await page.getByTestId('chat-model-picker').click()
    await expect(
      page.getByTestId('model-picker').getByRole('button', { name: 'All', exact: true })
    ).toHaveCount(0)
    await expect(page.getByTestId('model-picker').getByRole('combobox')).toHaveCount(0)
    await expect(
      page.getByTestId('model-picker').getByRole('button', { name: /^Test Sonnet 5.*Claude Code/ })
    ).toBeVisible()
    await expect(
      page.getByTestId('model-picker').getByRole('button', { name: /^Test Sonnet 5.*sonnet/ })
    ).toBeVisible()
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
    await expect(page.getByTestId('chat-tab').first()).toHaveText(userText)
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(page.getByTestId('chat-view').getByRole('status')).toContainText('Ready')
    await expect(page.getByTestId('chat-transcript').getByRole('status')).toContainText(
      'Ready · Native session saved'
    )
    // A completed turn keeps the green finished mark until the next turn.
    const sidebarAgents = page.locator(
      `[data-sidebar="menu-row"][data-workspace-id="${workspaceId}"] [data-testid="workspace-agent-open"]`
    )
    const finishedRow = page.locator(
      `[data-sidebar="menu-row"][data-workspace-id="${workspaceId}"] [data-agent-harness="codex"] [data-workspace-agent-status="finished"]`
    )
    await expect(finishedRow).toBeVisible()
    await expect(finishedRow).toHaveAttribute('aria-label', 'Agent finished')
    await expect(finishedRow).toHaveClass(/text-emerald-500/)
    await expect(sidebarAgents).toHaveCount(1)
    await expect(page.locator('[data-workspace-agent-status="waiting"]')).toHaveCount(0)
    await expect(page.locator('[data-workspace-agent-status="running"]')).toHaveCount(0)
    await expect(page.locator('[data-chat-agent-status="finished"]')).toBeVisible()
    await expect(page.getByRole('separator', { name: 'End of response' })).toHaveCount(1)
    await expect(page.getByTestId('context-usage-ring')).toContainText('17%')
    await page.getByTestId('context-usage-ring').hover()
    await expect(page.getByText('17% of context used')).toBeVisible()
    await expect(page.getByText('43,759 / 258,400 tokens')).toBeVisible()
    await mkdir(chatEvidenceDir, { recursive: true })
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
    const waitingIcon = page.locator(
      `[data-sidebar="menu-row"][data-workspace-id="${workspaceId}"] [data-agent-harness="codex"]`
    )
    const waitingRow = waitingIcon.locator('[data-workspace-agent-status]')
    await expect(waitingIcon).toHaveAttribute('data-agent-harness', 'codex')
    await expect(waitingIcon.getByRole('img', { name: 'Codex' })).toHaveAttribute(
      'data-harness-icon',
      'codex'
    )
    await expect(waitingRow).toHaveAttribute('data-workspace-agent-status', 'waiting')
    await expect(waitingRow).toHaveAttribute('aria-label', 'Agent needs your action')
    await expect(waitingRow).toHaveClass(/text-amber-500/)
    await expect(waitingRow.locator('.agent-status-dot')).toBeVisible()
    await expect(waitingIcon).not.toContainText('Codex')
    const waitingTitle = page.locator(`[data-testid="workspace-row-${workspaceId}"] span`).first()
    const waitingTitleBox = await waitingTitle.boundingBox()
    const waitingIconBox = await waitingIcon.boundingBox()
    const waitingBadgeBox = await waitingRow.boundingBox()
    expect(waitingIconBox!.y).toBeGreaterThan(waitingTitleBox!.y)
    expect(Math.abs(waitingIconBox!.x - waitingTitleBox!.x)).toBeLessThan(12)
    expect(waitingBadgeBox!.x).toBeGreaterThan(waitingIconBox!.x + waitingIconBox!.width / 2)
    expect(waitingBadgeBox!.y).toBeGreaterThan(waitingIconBox!.y + waitingIconBox!.height / 2)
    expect(waitingBadgeBox!.x + waitingBadgeBox!.width).toBeGreaterThan(
      waitingIconBox!.x + waitingIconBox!.width - 1
    )
    expect(waitingBadgeBox!.y + waitingBadgeBox!.height).toBeGreaterThan(
      waitingIconBox!.y + waitingIconBox!.height - 1
    )
    const agentButton = page.locator(
      `[data-sidebar="menu-row"][data-workspace-id="${workspaceId}"] [data-testid="workspace-agent-open"]`
    )
    await expect(agentButton).toHaveAttribute('data-agent-title', userText)
    await agentButton.hover()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toHaveText(/Build a normalized agent chat\s+Preserve spacing/)
    const iconBox = await agentButton.boundingBox()
    const tooltipBox = await tooltip.boundingBox()
    expect(Math.abs(tooltipBox!.x - iconBox!.x)).toBeLessThan(4)
    expect(tooltipBox!.y).toBeGreaterThan(iconBox!.y + iconBox!.height - 2)
    expect(tooltipBox!.x + tooltipBox!.width).toBeGreaterThan(iconBox!.x + iconBox!.width)
    await screenshotChatEvidence(page, 'agent-status-tooltip.png')
    await page.getByTestId('new-content-tab').click()
    await page.getByTestId('open-terminal-tab').click()
    await expect(page.getByTestId('terminal-tab')).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('content-tab-bar')).toHaveAttribute('data-variant', 'pill')
    await expect(page.getByTestId('terminal-tab')).toHaveAttribute('data-state', 'active')
    await expect(page.getByTestId('chat-tab').first()).toHaveAttribute('data-state', 'inactive')
    await agentButton.click()
    await expect(page.getByTestId('chat-tab').first()).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('chat-tab').first()).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
    await expect(page.locator('[data-chat-agent-status="waiting"]')).toBeVisible()
    await expect(page.locator('[data-chat-agent-status="waiting"]')).toHaveAttribute(
      'aria-label',
      'Agent needs your action'
    )
    await expect(page.locator('[data-chat-agent-status="waiting"] .agent-status-dots')).toHaveCount(
      0
    )
    await expect(page.getByTestId(`project-agent-status-${project.id}`)).toHaveCount(0)
    await expect(page.getByTestId('chat-tab').first()).toHaveText(userText)
    await screenshotChatEvidence(page, 'agent-status-blocked.png')
    await projectRow.click()
    const projectStatus = page.getByTestId(`project-agent-status-${project.id}`)
    await expect(projectStatus.locator('[data-harness-icon="codex"]')).toBeVisible()
    await expect(projectStatus.locator('[data-workspace-agent-status="waiting"]')).toBeVisible()
    await expect(projectStatus).not.toContainText('Codex')
    await expect(projectStatus).toHaveCSS('opacity', '0.6')
    await page.getByTestId('new-content-tab').click()
    await page.getByTestId('open-terminal-tab').click()
    await expect(page.getByTestId('terminal-tab').last()).toHaveAttribute('data-active', 'true')
    await projectStatus.getByTestId('workspace-agent-open').click()
    await expect(projectRow).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('chat-tab').first()).toHaveAttribute('data-active', 'true')
    await page.mouse.move(8, 8)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await projectRow.click()
    await expect(waitingRow).toBeVisible()
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
    const runningRow = page.locator(
      `[data-sidebar="menu-row"][data-workspace-id="${workspaceId}"] [data-agent-harness="codex"] [data-workspace-agent-status="running"]`
    )
    await expect(runningRow).toBeVisible()
    await expect(runningRow.locator('xpath=..')).not.toContainText('Codex')
    await expect(runningRow).toHaveClass(/text-sky-500/)
    await expect(runningRow.locator('.agent-status-dots > span')).toHaveCount(4)
    await expect(runningRow.locator('.agent-status-dots > span').first()).toHaveCSS(
      'animation-name',
      'agent-status-dot'
    )
    const runningTab = page.locator('[data-chat-agent-status="running"]')
    await expect(runningTab).toBeVisible()
    await expect(runningTab).toHaveClass(/text-sky-500/)
    await expect(runningTab.locator('.agent-status-dots > span').first()).toHaveCSS(
      'animation-name',
      'agent-status-dot'
    )
    const runningHarness = page.getByTestId('chat-tab-agent-icon')
    await expect(runningHarness).toHaveAttribute('data-harness-icon', 'codex')
    await expect(runningHarness).toHaveClass(/agent-harness-loading/)
    await expect(runningHarness).toHaveCSS('animation-name', 'agent-harness-loading')
    await expect(page.getByTestId('chat-tab').first()).toHaveText(userText)
    await working.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(chatEvidenceDir, 'working-shimmer.png') })
    await screenshotChatEvidence(page, 'agent-status-working.png')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(workingText).toHaveCSS('animation-name', 'none')
    await expect(workingText).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)')
    await expect(runningRow.locator('.agent-status-dots > span').first()).toHaveCSS(
      'animation-name',
      'none'
    )
    await expect(runningHarness).toHaveCSS('animation-name', 'none')
    await expect(runningRow).toHaveClass(/text-sky-500/)
    await page.screenshot({ path: join(chatEvidenceDir, 'working-reduced-motion.png') })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(runningRow.locator('.agent-status-dots > span').first()).toHaveCSS(
      'animation-name',
      'agent-status-dot'
    )
    await expect(runningHarness).toHaveCSS('animation-name', 'agent-harness-loading')
    await page.getByRole('button', { name: 'Stop agent' }).click()
    await expect(working).not.toContainText('Working…')
    await expect(page.getByRole('separator', { name: 'End of response' })).toHaveCount(4)
    await page.screenshot({ path: '/tmp/cerebro-chat-evidence/response-interrupted.png' })
    const interruptedRow = page.locator(
      `[data-sidebar="menu-row"][data-workspace-id="${workspaceId}"] [data-agent-harness="codex"] [data-workspace-agent-status="interrupted"]`
    )
    await expect(interruptedRow).toBeVisible()
    await expect(interruptedRow.locator('xpath=..')).not.toContainText('Codex')
    await expect(interruptedRow).toHaveAttribute('aria-label', 'Agent interrupted')
    await expect(interruptedRow).toHaveClass(/text-orange-500/)
    await expect(interruptedRow.locator('.agent-status-dots')).toHaveCount(0)
    await expect(interruptedRow.locator('.agent-status-dot')).toBeVisible()
    await expect(page.locator('[data-chat-agent-status="interrupted"]')).toHaveAttribute(
      'aria-label',
      'Agent interrupted'
    )
    await expect(page.getByTestId('chat-tab').first()).toHaveText(userText)
    await screenshotChatEvidence(page, 'agent-status-interrupted.png')
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
    await page.getByTestId('new-content-tab').click()
    await page.getByTestId('pane-menu-right').hover()
    await page.getByTestId('add-pane-right-chat').click()
    const panes = page.locator('[data-pane-kind="chat"]:visible')
    await expect(panes).toHaveCount(2)
    await expect(panes.nth(0).getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(panes.nth(1).getByTestId('chat-empty-hero')).toContainText(
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
    await expect(page.getByRole('alert')).toContainText('Open a new Agent tab or pane to use Pi.')
    await expect(chat.getByTestId('chat-model-picker')).toContainText('Claude Code')
    await expect(chat.getByTestId('chat-transcript')).toContainText('hello Claude')
    await page.getByTestId('new-content-tab').click()
    await page.getByTestId('open-chat-tab').click()
    // Tab switches keep prior agent panes mounted under display:none; re-query the active pane.
    const nextChat = page.locator('[data-pane-kind="chat"]:visible')
    await expect(nextChat.getByText('What would you like to build?')).toBeVisible()
    await expect(nextChat.getByTestId('chat-model-picker')).toBeVisible()
    await nextChat.getByTestId('chat-model-picker').click()
    await page.getByTestId('model-picker').getByRole('button', { name: 'Pi', exact: true }).click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Test Model.*Pi/ })
      .click()
    await expect(nextChat.getByTestId('chat-model-picker')).toContainText('Pi')
    await nextChat.getByRole('textbox', { name: 'Message agent' }).fill('hello Pi')
    await nextChat.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(nextChat.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(nextChat.getByTestId('chat-view').getByRole('status')).toContainText('Ready')
    await page.getByTestId('new-content-tab').click()
    await page.getByTestId('pane-menu-right').hover()
    await page.getByTestId('add-pane-right-terminal').press('Enter')
    await expect(page.locator('[data-pane-kind="chat"]:visible')).toHaveCount(1)
    await expect(page.locator('[data-pane-kind="terminal"]:visible')).toHaveCount(1)
    await expect(page.locator('[data-terminal-status="running"]')).toBeVisible()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('queued messages during a running turn can be steered in immediately or sent automatically', async ({
  page
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-steer-'))
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
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    await page.getByRole('button', { name: /^New Agent tab/ }).click()
    await expect(page.getByTestId('chat-model-picker')).toContainText('Claude Code')
    const message = page.getByRole('textbox', { name: 'Message agent' })
    const send = page.getByRole('button', { name: 'Send message', exact: true })
    await message.fill('slow')
    await send.click()
    await expect(page.getByRole('button', { name: 'Stop agent' })).toBeVisible()

    // Sending while busy queues instead of erroring.
    await message.fill('please steer this in')
    await send.click()
    await expect(page.getByTestId('chat-transcript').getByRole('alert')).toHaveCount(0)
    await expect(page.getByTestId('chat-queue-item')).toHaveCount(1)
    await expect(page.getByTestId('chat-queue-item').first()).toContainText('please steer this in')
    await message.fill('follow-up message')
    await send.click()
    await expect(page.getByTestId('chat-queue-item')).toHaveCount(2)

    // Steering one queued message folds it into the running turn without disturbing the other.
    await page
      .getByTestId('chat-queue-item')
      .filter({ hasText: 'please steer this in' })
      .getByRole('button', { name: 'Steer' })
      .click()
    await expect(page.getByTestId('chat-queue-item')).toHaveCount(1)
    await expect(page.getByTestId('chat-queue-item').first()).toContainText('follow-up message')
    await expect(page.getByTestId('chat-transcript')).toContainText(
      '[steered: please steer this in]'
    )
    await expect(page.getByRole('button', { name: 'Stop agent' })).toBeVisible()

    // Stopping leaves the queue intact; it becomes the next turn automatically.
    await page.getByRole('button', { name: 'Stop agent' }).click()
    await expect(page.getByTestId('chat-view').getByRole('status')).toContainText('Ready', {
      timeout: 15_000
    })
    await expect(page.getByTestId('chat-queue')).toHaveCount(0)
    await expect(page.getByTestId('chat-transcript')).toContainText('follow-up message')
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
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

test('Mod+N opens independent Agent tabs from a workspace row, composer, and terminal', async ({
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
    await expect(page.getByRole('button', { name: /^New Agent tab/ })).toBeVisible()
    await expect(page.getByTestId('workspace-empty-state')).toContainText('Start an Agent')
    await mkdir('/tmp/cerebro-pane-session-evidence', { recursive: true })
    await page.screenshot({ path: '/tmp/cerebro-pane-session-evidence/agent-empty-state.png' })
    await row.focus()
    await page.keyboard.press(chord)
    await expect(page.getByTestId('chat-tab')).toHaveCount(1)
    const chat = page.locator('[data-pane-kind="chat"]:visible')
    const firstPane = await chat.getAttribute('data-pane-id')
    await chat.getByRole('textbox', { name: 'Message agent' }).fill('Keep this draft')
    await page.keyboard.press(chord)
    await expect(page.getByTestId('chat-tab')).toHaveCount(2)
    await expect(chat).not.toHaveAttribute('data-pane-id', firstPane!)
    await expect(chat.getByRole('textbox', { name: 'Message agent' })).toHaveAttribute(
      'data-composer-text',
      ''
    )
    await page.getByTestId('chat-tab').first().click()
    await expect(chat.getByRole('textbox', { name: 'Message agent' })).toHaveAttribute(
      'data-composer-text',
      'Keep this draft'
    )
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+t' : 'Control+t')
    const terminal = page.locator('[data-terminal-active="true"] .xterm-helper-textarea')
    await expect(terminal).toBeFocused()
    await page.keyboard.press(chord)
    await expect(page.getByTestId('chat-tab')).toHaveCount(3)
    await expect(chat.getByTestId('chat-empty-hero')).toContainText('What would you like to build?')
    await expect(chat.getByTestId('chat-composer')).toHaveAttribute('data-dock', 'center')
    await page.getByTestId('new-content-tab').click()
    await expect(page.getByTestId('open-chat-tab').locator('[data-hotkey="Mod+N"]')).toBeVisible()
    await mkdir('/tmp/cerebro-pane-session-evidence', { recursive: true })
    await expect(page.getByTestId('add-tab-menu').locator('[data-testid^="open-"]')).toHaveText([
      /Agent/,
      /Terminal/,
      /Changes/
    ])
    await expect(page.getByTestId('add-tab-menu')).toHaveCSS('opacity', '1')
    await page.screenshot({ path: '/tmp/cerebro-pane-session-evidence/agent-new-tab-menu.png' })
    await page.getByTestId('pane-menu-right').hover()
    await expect(page.locator('[data-testid^="add-pane-right-"]')).toHaveText([
      'Agent',
      'Terminal',
      'Changes'
    ])
    await page.screenshot({ path: '/tmp/cerebro-pane-session-evidence/agent-split-pane-menu.png' })
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
    const composerText = (): Promise<string | null> => textbox.getAttribute('data-composer-text')
    const caret = (): Promise<number> =>
      textbox.evaluate((element) => Number(element.getAttribute('data-composer-caret')))
    const placeCaret = async (offset: number): Promise<void> => {
      await textbox.focus()
      await textbox.press('Home')
      for (let index = 0; index < offset; index++) await textbox.press('ArrowRight')
      await expect.poll(caret).toBe(offset)
    }
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
    await placeCaret(11)
    const dropped = await transfer('first.png')
    await form.dispatchEvent('dragover', { dataTransfer: dropped })
    await expect(chat.getByTestId('chat-drop-overlay')).toBeVisible()
    await form.dispatchEvent('drop', { dataTransfer: dropped })
    await expect(chat.getByTestId('chat-drop-overlay')).toHaveCount(0)
    await expect(attachments).toHaveCount(1)
    await expect(attachments.first()).toContainText('first.png')
    await expect.poll(composerText).toBe('attachments [Image #1] here')
    expect(await caret()).toBe(22)
    await paste('second.png')
    await expect(attachments).toHaveCount(2)
    await expect.poll(composerText).toBe('attachments [Image #1] [Image #2] here')
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
    await expect.poll(composerText).toBe('attachments [Image #1] here')
    expect(await caret()).toBe(23)
    // Typing over part of a chip removes it entirely. The chip is atomic, so the first
    // shift-right selects it and the second includes the following space.
    await placeCaret(12)
    await textbox.press('Shift+ArrowRight')
    await textbox.press('Shift+ArrowRight')
    await textbox.type('x')
    await expect(attachments).toHaveCount(0)
    await expect.poll(composerText).toBe('attachments xhere')
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
    await expect.poll(composerText).toBe('attachments here [Image #1] [Image #1] ')
    await paste('fourth.png')
    await expect(attachments).toHaveCount(2)
    await expect.poll(composerText).toBe('attachments here [Image #1] [Image #1] [Image #2] ')
    await chat.getByRole('button', { name: 'Remove image 1', exact: true }).click()
    await expect(attachments).toHaveCount(1)
    await expect(attachments.first()).toContainText('fourth.png')
    await expect(attachments.first()).toContainText('#1')
    await expect.poll(composerText).toBe('attachments here [Image #1] [Image #1] ')
    // Reload keeps plain text and drops chips with their attachments.
    await page.reload()
    await expect.poll(composerText).toBe('attachments here [Image #1]')
    await expect(attachments).toHaveCount(0)
    await paste('sent.png')
    await expect.poll(composerText).toBe('attachments here [Image #1] [Image #1] ')
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
    await expect.poll(composerText).toBe('')
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

test('multi-root root row keeps agent status inside the row chrome', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-multiroot-agent-e2e-'))
  const parent = join(root, 'apps-folder')
  const frontend = join(parent, 'frontend')
  const backend = join(parent, 'backend')
  try {
    for (const [dir, marker] of [
      [frontend, 'frontend-app'],
      [backend, 'backend-app']
    ] as const) {
      await mkdir(dir, { recursive: true })
      await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir })
      await execFileAsync('git', ['config', 'user.email', 'e2e@cerebro.local'], { cwd: dir })
      await execFileAsync('git', ['config', 'user.name', 'Cerebro E2E'], { cwd: dir })
      await writeFile(join(dir, 'README.md'), `${marker}\n`)
      await execFileAsync('git', ['add', '.'], { cwd: dir })
      await execFileAsync('git', ['commit', '-m', `init ${marker}`], { cwd: dir })
    }
    const project = await page.evaluate(
      (directory) => window.cerebro.createProjectFromDirectory(directory),
      parent
    )
    const rootWorkspace = project.workspaces.find((workspace) => workspace.kind === 'root')
    expect(rootWorkspace).toBeTruthy()
    await page.reload()
    const projectRow = page.getByTestId(`project-row-${project.id}`)
    await expect(projectRow).toBeVisible()
    if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
    const rootRow = page.getByTestId(`project-root-${project.id}`)
    await rootRow.click()
    await page.getByRole('button', { name: /^New Agent tab/ }).click()
    await page.getByTestId('chat-model-picker').click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: 'Codex', exact: true })
      .click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Test Model.*Codex/ })
      .click()
    await page.getByRole('combobox', { name: 'Access mode' }).selectOption('edit')
    await page.getByRole('textbox', { name: 'Message agent' }).fill('approval')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
    const agentIcon = rootRow.locator('[data-agent-harness="codex"]')
    await expect(agentIcon).toBeVisible()
    await expect(agentIcon.locator('[data-workspace-agent-status="waiting"]')).toBeVisible()
    await expect(rootRow.getByTestId('workspace-agent-open')).toHaveCount(1)
    await expect(page.getByTestId('chat-tab')).toHaveCount(1)
    const rootBox = await rootRow.boundingBox()
    const iconBox = await agentIcon.boundingBox()
    expect(rootBox).toBeTruthy()
    expect(iconBox).toBeTruthy()
    expect(iconBox!.y).toBeGreaterThan(rootBox!.y)
    expect(iconBox!.y + iconBox!.height).toBeLessThanOrEqual(rootBox!.y + rootBox!.height + 1)
    expect(iconBox!.x).toBeGreaterThanOrEqual(rootBox!.x)
    await mkdir('/tmp/cerebro-sidebar-evidence', { recursive: true })
    await page.screenshot({ path: '/tmp/cerebro-sidebar-evidence/multi-root-root-agent.png' })
    await page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect(page.getByTestId('chat-view').getByRole('status')).toContainText('Ready')
    await expect(
      rootRow.locator('[data-agent-harness="codex"] [data-workspace-agent-status="finished"]')
    ).toBeVisible()
    await expect(rootRow.getByTestId('workspace-agent-open')).toHaveCount(1)
    await page.screenshot({ path: '/tmp/cerebro-sidebar-evidence/multi-root-root-agent-idle.png' })
    const chatTab = page.getByTestId('chat-tab')
    await chatTab.hover()
    await chatTab.getByTestId('content-tab-close').click()
    await expect(page.getByTestId('chat-tab')).toHaveCount(0)
    await expect(rootRow.getByTestId('workspace-agent-open')).toHaveCount(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

type AgentPaneFlashProbe = {
  sawLoading: boolean
  sawEmptyCenter: boolean
}

async function installAgentPaneLoadProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Flash = { sawLoading: boolean; sawEmptyCenter: boolean }
    const flash: Flash = { sawLoading: false, sawEmptyCenter: false }
    ;(window as unknown as { __agentPaneFlash: Flash }).__agentPaneFlash = flash

    const sample = (): void => {
      if (document.querySelector('[data-testid="chat-loading"]')) flash.sawLoading = true
      const dock = document.querySelector('[data-testid="chat-composer"]')
      const hero = document.querySelector('[data-testid="chat-empty-hero"]')
      if (dock?.getAttribute('data-dock') !== 'center' || !(hero instanceof HTMLElement)) return
      const style = getComputedStyle(hero)
      if (style.visibility !== 'hidden' && Number(style.opacity) > 0) flash.sawEmptyCenter = true
    }

    const startObserver = (): void => {
      new MutationObserver(sample).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true
      })
      const loop = (): void => {
        sample()
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    }

    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', startObserver)
    else startObserver()
  })
}

async function setChatGetDelay(electronApp: ElectronApplication, delayMs: number): Promise<void> {
  await electronApp.evaluate((_electron, delay) => {
    ;(globalThis as { __cerebroChatGetDelayMs?: number }).__cerebroChatGetDelayMs = delay
  }, delayMs)
}

async function readAgentPaneFlash(page: Page): Promise<AgentPaneFlashProbe> {
  return page.evaluate(() => {
    const flash = (window as unknown as { __agentPaneFlash?: AgentPaneFlashProbe }).__agentPaneFlash
    return flash ?? { sawLoading: false, sawEmptyCenter: false }
  })
}

test('agent pane loading does not flash empty placeholder before session is confirmed', async ({
  page,
  electronApp
}) => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-loading-'))
  const mediaDir = '/cursor/stores/bc-ece937fc-5124-4a69-b19a-e93de51a8c0f/media'
  try {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1250, 900)
    )
    await setChatGetDelay(electronApp, 3_000)
    await installAgentPaneLoadProbe(page)
    const project = await page.evaluate(
      (folder) => window.cerebro.createProjectFromDirectory(folder),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.reload()
    const projectRow = page.getByTestId(/project-row-/).first()
    await expect(projectRow).toBeVisible()
    if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    await page.getByRole('button', { name: /^New Agent tab/ }).click()

    const chat = page.getByTestId('chat-view')
    const shots = await ensureArtifactDir(mediaDir)
    const artifacts = await ensureArtifactDir(preferredArtifactsDir)
    await expect(page.getByTestId('chat-loading')).toBeVisible()
    // Capture while get is still delayed — do not await extra work before this shot.
    await page.screenshot({ path: join(shots, 'agent-section-loading.png') })
    await page.screenshot({ path: join(artifacts, 'agent-section-loading.png') })
    const duringFirstLoad = await page.evaluate(() => ({
      loading: Boolean(document.querySelector('[data-testid="chat-loading"]')),
      dataLoading: document
        .querySelector('[data-testid="chat-view"]')
        ?.getAttribute('data-loading'),
      composer: document.querySelectorAll('[data-testid="chat-composer"]').length,
      hero: document.querySelectorAll('[data-testid="chat-empty-hero"]').length,
      loadingText: document.querySelector('[data-testid="chat-loading"]')?.textContent ?? null
    }))
    expect(duringFirstLoad).toEqual({
      loading: true,
      dataLoading: 'true',
      composer: 0,
      hero: 0,
      loadingText: 'Loading…'
    })

    await expect(page.getByTestId('chat-loading')).toHaveCount(0, { timeout: 15_000 })
    await expect(chat).not.toHaveAttribute('data-loading', 'true')
    await expect(page.getByTestId('chat-composer')).toHaveAttribute('data-dock', 'center')
    await expect(page.getByTestId('chat-empty-hero')).toBeVisible()
    await expect(page.getByTestId('chat-empty-hero')).toContainText('What would you like to build?')
    await expect(page.getByTestId('chat-composer-glow')).toHaveCount(0)
    const emptyFlash = await readAgentPaneFlash(page)
    expect(emptyFlash.sawLoading).toBe(true)
    await page.screenshot({ path: join(shots, 'agent-section-empty.png') })
    await page.screenshot({ path: join(artifacts, 'agent-section-empty.png') })

    await page.getByTestId('chat-model-picker').click()
    await page.getByRole('button', { name: 'Codex', exact: true }).click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Test Model.*Codex/ })
      .click()
    await page.getByRole('textbox', { name: 'Message agent' }).fill('Persist through reload')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(page.getByTestId('chat-composer')).toHaveAttribute('data-dock', 'bottom')

    await page.reload()
    // Tab-icon queries share the chat key and may settle before ChatView mounts; the
    // critical guarantee is that the empty centered placeholder never appears first.
    await expect(page.getByTestId('chat-transcript')).toContainText('Persist through reload', {
      timeout: 15_000
    })
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(page.getByTestId('chat-composer')).toHaveAttribute('data-dock', 'bottom')
    await expect(page.getByTestId('chat-composer')).toHaveAttribute('data-motion', 'off')
    await expect(page.getByTestId('chat-empty-hero')).toHaveCSS('visibility', 'hidden')
    await expect(page.getByTestId('chat-composer-glow')).toHaveCount(0)
    const loadedFlash = await readAgentPaneFlash(page)
    expect(loadedFlash.sawEmptyCenter).toBe(false)
    await page.screenshot({ path: join(shots, 'agent-section-loaded.png') })
    await page.screenshot({ path: join(artifacts, 'agent-section-loaded.png') })
  } finally {
    await setChatGetDelay(electronApp, 0).catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
})

test('empty agent pane shows a light teal star field until the first message', async ({
  page,
  electronApp
}) => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-stars-'))
  try {
    const artifacts = await ensureArtifactDir(preferredArtifactsDir)
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1250, 900)
    )
    const project = await page.evaluate(
      (folder) => window.cerebro.createProjectFromDirectory(folder),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.reload()
    const projectRow = page.getByTestId(/project-row-/).first()
    await expect(projectRow).toBeVisible()
    if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    await page.getByRole('button', { name: /^New Agent tab/ }).click()

    await expect(page.getByTestId('chat-empty-hero')).toBeVisible()
    const stars = page.getByTestId('chat-stars')
    await expect(stars).toBeVisible()
    await expect(stars).toHaveAttribute('data-star-color', /sidebar-selected/)
    const starDot = stars.locator('[data-slot="star-layer"]').first().locator('div').first()
    const starShadow = await starDot.evaluate((el) => getComputedStyle(el).boxShadow)
    // Theme teal lifted toward white, not the near-invisible 16% specks.
    expect(starShadow).toMatch(/rgb|color\(/)
    expect(starShadow).not.toMatch(/0\.16/)
    const background = await stars.evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(background).toContain('radial-gradient')
    expect(background).toMatch(/0\.08|8%/)
    const send = page.getByRole('button', { name: 'Send message', exact: true })
    const box = await send.boundingBox()
    expect(box).toBeTruthy()
    const hit = await page.evaluate(
      ({ x, y }) => {
        const node = document.elementFromPoint(x, y)
        return node?.closest('button')?.getAttribute('aria-label')
      },
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
    )
    expect(hit).toBe('Send message')
    await page.screenshot({
      path: join(artifacts, 'agent-pane-stars-200.png')
    })

    await page.getByRole('textbox', { name: 'Message agent' }).fill('Hello stars')
    await expect(page.getByTestId('chat-composer')).toHaveAttribute('data-dock', 'center')
    await expect(page.getByTestId('chat-stars')).toBeVisible()
    await page.screenshot({ path: join(artifacts, 'agent-pane-stars-while-typing.png') })
    await send.click()
    await expect(page.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(page.getByTestId('chat-stars')).toHaveCount(0)
    await expect(page.getByTestId('chat-composer')).toHaveAttribute('data-dock', 'bottom')
    await page.screenshot({ path: join(artifacts, 'agent-pane-stars-after-first-send.png') })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('empty agent pane switches between stars, glow, and off', async ({ page, electronApp }) => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-background-'))
  try {
    const artifacts = await ensureArtifactDir(preferredArtifactsDir)
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1250, 900)
    )
    const project = await page.evaluate(
      (folder) => window.cerebro.createProjectFromDirectory(folder),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.reload()
    const projectRow = page.getByTestId(/project-row-/).first()
    await expect(projectRow).toBeVisible()
    if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    await page.getByRole('button', { name: /^New Agent tab/ }).click()

    const choose = async (
      label: 'Glow' | 'Stars' | 'Off',
      value: 'glow' | 'stars' | 'off'
    ): Promise<void> => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const background = page.getByTestId('settings-agent-background')
      await background.click()
      await page.getByRole('option', { name: label, exact: true }).click()
      await expect(background).toHaveText(label)
      await page.getByRole('button', { name: 'Back' }).click()
      await expect(page.getByTestId('chat-view')).toHaveAttribute('data-agent-background', value)
    }

    await expect(page.getByTestId('chat-view')).toHaveAttribute('data-agent-background', 'stars')
    await expect(page.getByTestId('chat-stars')).toBeVisible()
    await expect(page.getByTestId('chat-composer-glow')).toHaveCount(0)
    await page.screenshot({ path: join(artifacts, 'agent-background-stars.png') })

    await choose('Glow', 'glow')
    await expect(page.getByTestId('chat-stars')).toHaveCount(0)
    await expect(page.getByTestId('chat-composer-glow')).toBeVisible()
    await expect(page.getByTestId('chat-composer')).toHaveAttribute('data-dock', 'center')
    await page.screenshot({ path: join(artifacts, 'agent-background-glow.png') })

    await choose('Off', 'off')
    await expect(page.getByTestId('chat-stars')).toHaveCount(0)
    await expect(page.getByTestId('chat-composer-glow')).toHaveCount(0)
    await expect(page.getByTestId('chat-empty-hero')).toBeVisible()
    await page.screenshot({ path: join(artifacts, 'agent-background-off.png') })

    await choose('Stars', 'stars')
    await expect(page.getByTestId('chat-stars')).toBeVisible()
    await expect(page.getByTestId('chat-composer-glow')).toHaveCount(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
