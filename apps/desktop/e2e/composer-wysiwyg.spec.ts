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

test('agent composer renders bullets, inline code, a code block, and Add tags', async ({
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
    await page.keyboard.type('- Ship the `notes`')
    await expect(composer.locator('li')).toHaveText('Ship the notes')
    await expect(composer.locator('li code')).toHaveText('notes')
    await expect(composer.locator('h1, h2, h3')).toHaveCount(0)
    await mkdir(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'composer-bullet.png') })

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
    const markdown = await composer.getAttribute('data-composer-text')
    expect(markdown).toContain('Ship the `notes`')
    expect(markdown).toContain('```javascript')
    expect(markdown).toContain('const value = 1')
    expect(markdown).toContain('@B')
    expect(markdown).not.toMatch(/^#{1,3} /m)
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
    const sent = page.getByTestId('chat-user-message').first()
    await expect(sent.locator('li p').first()).toHaveText('Ship the notes')
    await expect(sent.locator('p code')).toHaveText('notes')
    await expect(sent.locator('.hljs-keyword')).toHaveText('const')
    await expect(sent.getByTestId('composer-code-language')).toHaveText('JavaScript')
    await expect(sent.getByTestId('composer-tag')).toHaveText('@B')
    await expect(sent.locator('h1, h2, h3')).toHaveCount(0)
    await expect(composer).toHaveAttribute('data-composer-text', '')
    await expect(page.getByTestId('model-picker')).toBeHidden()
    await sent.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, 'composer-sent.png') })
    await sent.screenshot({ path: join(evidence, 'composer-sent-message.png') })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
