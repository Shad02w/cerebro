import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect } from './fixtures'

const executable = resolve(__dirname, '../../../packages/mux/src/agents/fixtures/fake-harness.cjs')
const evidence = '/tmp/cerebro-rewind-evidence'

test.use({
  agentEnvironment: {
    CEREBRO_CODEX_PATH: executable,
    CEREBRO_CLAUDE_PATH: executable,
    CEREBRO_PI_PATH: executable
  }
})

test('rewind puts the prompt in the composer and undo restores the turn', async ({
  page,
  electronApp
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-chat-rewind-'))
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
    await chat.getByTestId('chat-model-picker').click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: 'Codex', exact: true })
      .click()
    await page
      .getByTestId('model-picker')
      .getByRole('option', { name: 'Test Model', exact: true })
      .click()

    const composer = chat.getByRole('textbox', { name: 'Message agent' })
    await composer.fill('first prompt')
    await chat.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(chat.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await composer.fill('second prompt')
    await chat.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(chat.getByTestId('chat-user-message')).toHaveCount(2)
    await expect(chat.getByTestId('chat-transcript').getByRole('status')).toHaveCount(0)

    await chat.getByTestId('chat-user-message').nth(1).getByTestId('chat-rewind').click()
    await expect(chat.getByTestId('chat-user-message')).toHaveCount(1)
    await expect(chat.getByTestId('chat-transcript')).toContainText('first prompt')
    await expect(chat.getByTestId('chat-transcript')).toContainText('Adapter connected.')
    await expect(chat.getByTestId('chat-transcript')).not.toContainText('second prompt')
    const notice = chat.getByTestId('chat-rewind-notice')
    await expect(notice).toHaveText(/Rewound to this response\. Changes were not restored\./)
    await expect(notice.getByTestId('chat-rewind-undo')).toHaveText('Undo')
    await expect(chat.getByTestId('chat-composer').getByTestId('chat-rewind-notice')).toHaveCount(0)
    const underResponse = await chat.getByTestId('chat-transcript').evaluate((node) => {
      const separator = node.querySelector('[aria-label="End of response"]')
      const line = node.querySelector('[data-testid="chat-rewind-notice"]')
      if (!separator || !line) return false
      return Boolean(separator.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(underResponse).toBe(true)
    await expect(composer).toContainText('second prompt')
    await mkdir(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'rewound.png') })

    await notice.getByTestId('chat-rewind-undo').click()
    await expect(chat.getByTestId('chat-rewind-notice')).toHaveCount(0)
    await expect(chat.getByTestId('chat-user-message')).toHaveCount(2)
    await expect(chat.getByTestId('chat-transcript')).toContainText('second prompt')
    await expect(chat.getByRole('separator', { name: 'End of response' })).toHaveCount(2)
    await expect(composer).not.toContainText('second prompt')
    await page.screenshot({ path: join(evidence, 'restored.png') })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
