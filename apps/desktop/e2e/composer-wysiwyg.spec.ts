import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect } from './fixtures'

const executable = resolve(__dirname, '../../../packages/mux/src/agents/fixtures/fake-harness.cjs')
test.use({
  agentEnvironment: {
    CEREBRO_CODEX_PATH: executable,
    CEREBRO_CLAUDE_PATH: executable,
    CEREBRO_PI_PATH: executable
  }
})

test('agent composer renders markdown, a code language menu, and Add tags', async ({
  page,
  electronApp
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-composer-wysiwyg-'))
  const evidence = '/opt/cursor/artifacts'
  try {
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
    const composer = page.getByRole('textbox', { name: 'Message agent' })
    await expect(composer).toBeVisible()
    await composer.click()
    await page.keyboard.type('# Release notes')
    await expect(composer.locator('h1')).toHaveText('Release notes')
    await mkdir(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'composer-heading.png') })

    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('``` ')
    const code = page.getByTestId('composer-code-block')
    await expect(code).toBeVisible()
    await page.keyboard.type('const value = 1')
    await page.getByTestId('composer-code-language').click()
    const languages = page.getByTestId('composer-code-language-menu')
    await expect(languages.getByRole('option', { name: 'Plain text', exact: true })).toBeVisible()
    await expect(languages.getByRole('option', { name: 'JavaScript', exact: true })).toBeVisible()
    await expect(languages.getByRole('option', { name: 'TypeScript', exact: true })).toBeVisible()
    await expect(languages.getByRole('option', { name: 'Python', exact: true })).toBeVisible()
    await page.screenshot({ path: join(evidence, 'composer-code-languages.png') })
    await page.getByTestId('composer-code-language-javascript').click()
    await expect(code.locator('.hljs-keyword')).toHaveText('const')
    await page.screenshot({ path: join(evidence, 'composer-code-highlight.png') })

    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('@')
    const addMenu = page.getByTestId('composer-add-menu')
    await expect(addMenu).toBeVisible()
    await expect(addMenu.getByRole('option')).toHaveText(['A', 'B', 'C'])
    await page.screenshot({ path: join(evidence, 'composer-add-menu.png') })
    await addMenu.getByTestId('composer-add-option-B').click()
    await expect(composer.getByTestId('composer-tag')).toHaveText('@B')
    await expect(composer).toHaveAttribute(
      'data-composer-text',
      '# Release notes\n```javascript\nconst value = 1\n```\n@B '
    )
    await page.screenshot({ path: join(evidence, 'composer-tag.png') })

    await page.getByTestId('chat-model-picker').click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: 'Codex', exact: true })
      .click()
    await page
      .getByTestId('model-picker')
      .getByRole('button', { name: /^Test Model.*Codex/ })
      .click()
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByTestId('chat-user-message').first()).toContainText('# Release notes')
    await expect(page.getByTestId('chat-user-message').first()).toContainText('```javascript')
    await expect(page.getByTestId('chat-user-message').first()).toContainText('@B')
    await expect(composer).toHaveAttribute('data-composer-text', '')
    await page.screenshot({ path: join(evidence, 'composer-sent.png') })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
