import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

const executable = resolve(__dirname, '../../../packages/mux/src/agents/fixtures/fake-harness.cjs')
const evidenceDir = '/tmp/cerebro-notification-evidence'

test.use({
  agentEnvironment: {
    CEREBRO_CODEX_PATH: executable,
    CEREBRO_CLAUDE_PATH: executable,
    CEREBRO_PI_PATH: executable
  }
})

async function openAgentThenBackground(page: Page, directory: string): Promise<void> {
  const project = await page.evaluate(
    (directory) => window.cerebro.createProjectFromDirectory(directory),
    directory
  )
  await page.reload()
  const projectRow = page.getByTestId(/project-row-/).first()
  if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
  const workspaceId = project.workspaces[0].id
  await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
  await page.getByRole('button', { name: /^New Agent tab/ }).click()
  await expect(page.getByTestId('chat-view')).toBeVisible()
  const paneId = Number(await page.locator('[data-pane-id]').first().getAttribute('data-pane-id'))
  await page.evaluate(
    (workspaceId) =>
      window.cerebro.layoutCommand({
        target: 'tab',
        action: 'create',
        workspaceId,
        kind: 'terminal'
      } as never),
    workspaceId
  )
  await expect(page.getByTestId('chat-view')).toBeHidden()
  await page.evaluate(
    async ({ workspaceId, paneId }) => {
      const catalog = await window.cerebro.agentCatalog(false)
      const model = catalog.models.find((m) => m.harness === 'codex') ?? catalog.models[0]
      await window.cerebro.chatCommand({
        action: 'send',
        workspaceId,
        paneId,
        commandId: 'notify-e2e',
        text: 'approval',
        accessMode: 'edit',
        model
      })
    },
    { workspaceId, paneId }
  )
}

test('a pane the user is looking at raises no card', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-notify-e2e-'))
  try {
    await page.evaluate(
      (directory) => window.cerebro.createProjectFromDirectory(directory),
      directory
    )
    await page.reload()
    const projectRow = page.getByTestId(/project-row-/).first()
    if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
    await page.locator('button[data-workspace-id]').first().click()
    await page.getByRole('button', { name: /^New Agent tab/ }).click()
    await page.getByRole('combobox', { name: 'Access mode' }).selectOption('edit')
    await page.getByRole('textbox', { name: 'Message agent' }).fill('approval')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
    await expect(page.getByTestId('agent-notification')).toHaveCount(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a blocked agent in a background tab raises a card that opens its pane', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-notify-e2e-'))
  try {
    await openAgentThenBackground(page, directory)
    const card = page.getByTestId('agent-notification')
    await expect(card).toContainText('Cerebro needs your approval')
    await expect(card.getByTestId('agent-notification-command')).toHaveText('git status --short')
    await page.screenshot({ path: join(evidenceDir, 'blocked-card.png') })
    await card.getByText('Cerebro needs you', { exact: false }).click()
    await expect(page.getByTestId('chat-view')).toBeVisible()
    await expect(card).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Allow on the card answers the agent without opening the pane', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-notify-e2e-'))
  try {
    await openAgentThenBackground(page, directory)
    await page.getByTestId('agent-notification').getByRole('button', { name: 'Allow' }).click()
    await expect(page.getByTestId('chat-view')).toBeHidden()
    await expect(page.getByTestId('agent-notification')).toContainText('Done:')
    await page.screenshot({ path: join(evidenceDir, 'finished-card.png') })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
