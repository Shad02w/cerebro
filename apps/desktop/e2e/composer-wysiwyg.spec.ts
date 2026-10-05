import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Locator } from '@playwright/test'
import { test, expect } from './fixtures'

const executable = resolve(__dirname, '../../../packages/mux/src/agents/fixtures/fake-harness.cjs')

/** Ink boxes for @, its label, and the previous letter. A lifted @ sits above the label. */
async function tagInk(tag: Locator): Promise<{
  atTop: number
  atBottom: number
  labelTop: number
  labelBottom: number
  neighborBottom: number
}> {
  return tag.evaluate((element) => {
    const box = (node: Text, index: number): DOMRect => {
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 1)
      return range.getBoundingClientRect()
    }
    const text = [...element.childNodes].find(
      (node): node is Text =>
        node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.includes('@'))
    )
    if (!text?.textContent) throw new Error('tag has no text')
    const atIndex = text.textContent.indexOf('@')
    const at = box(text, atIndex)
    const label = box(text, atIndex + 1)
    const previous = element.previousSibling
    if (previous?.nodeType !== Node.TEXT_NODE || !previous.textContent)
      throw new Error('tag has no neighboring text')
    let neighborIndex = previous.textContent.length - 1
    while (neighborIndex >= 0 && /\s/.test(previous.textContent[neighborIndex] ?? ''))
      neighborIndex -= 1
    if (neighborIndex < 0) throw new Error('tag neighbor is blank')
    return {
      atTop: at.top,
      atBottom: at.bottom,
      labelTop: label.top,
      labelBottom: label.bottom,
      neighborBottom: box(previous, neighborIndex).bottom
    }
  })
}
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
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-composer-wysiwyg-'))
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
    const dock = page.getByTestId('chat-composer')
    const shell = page.getByTestId('chat-composer-shell')
    const form = shell.locator('form.chat-composer-shell')
    await expect(shell).toBeVisible()
    await expect(dock).toHaveAttribute('data-dock', 'center')
    await expect(page.getByTestId('chat-empty-hero')).toBeVisible()
    await expect(page.getByTestId('chat-composer-glow')).toHaveCount(0)
    await expect(form).toBeVisible()
    // Center the shell/form itself — hero copy is absolutely positioned above it.
    await expect
      .poll(async () => {
        const formBox = await form.boundingBox()
        const viewBox = await page.getByTestId('chat-view').boundingBox()
        if (!formBox || !viewBox) return Number.POSITIVE_INFINITY
        return Math.abs(formBox.y + formBox.height / 2 - (viewBox.y + viewBox.height / 2))
      })
      .toBeLessThan(24)
    await page.screenshot({ path: testInfo.outputPath('composer-glow.png') })
    await shell.screenshot({ path: testInfo.outputPath('composer-glow-shell.png') })
    const composer = page.getByRole('textbox', { name: 'Message agent' })
    await expect(composer).toBeVisible()
    await composer.click()
    await page.keyboard.type('- Ship the `notes`')
    await expect(composer.locator('li')).toHaveText('Ship the notes')
    await expect(composer.locator('li code')).toHaveText('notes')
    await expect(composer.locator('h1, h2, h3')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('composer-bullet.png') })

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
    await page.screenshot({ path: testInfo.outputPath('composer-code-languages.png') })
    await page.getByTestId('composer-code-language-javascript').click()
    await expect(code.locator('.hljs-keyword')).toHaveText('const')
    await page.screenshot({ path: testInfo.outputPath('composer-code-highlight.png') })

    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('@')
    const addMenu = page.getByTestId('composer-add-menu')
    await expect(addMenu).toBeVisible()
    await expect(addMenu.getByRole('option')).toHaveText(['A', 'B', 'C'])
    await page.screenshot({ path: testInfo.outputPath('composer-add-menu.png') })
    await addMenu.getByTestId('composer-add-option-B').click()
    await expect(composer.getByTestId('composer-tag')).toHaveText('@B')
    const markdown = await composer.getAttribute('data-composer-text')
    expect(markdown).toContain('Ship the `notes`')
    expect(markdown).toContain('```javascript')
    expect(markdown).toContain('const value = 1')
    expect(markdown).toContain('@B')
    expect(markdown).not.toMatch(/^#{1,3} /m)
    await page.screenshot({ path: testInfo.outputPath('composer-tag.png') })
    await composer.screenshot({ path: testInfo.outputPath('composer-field.png') })
    const tagColor = await composer.getByTestId('composer-tag').evaluate((element) => {
      const color = getComputedStyle(element).color
      return color
    })
    expect(tagColor).not.toBe('rgb(255, 255, 255)')
    await page.keyboard.press('Backspace')
    await expect(composer.getByTestId('composer-tag')).toHaveText('@B')
    await page.keyboard.press('Backspace')
    await expect(composer.getByTestId('composer-tag')).toHaveCount(0)
    expect(await composer.getAttribute('data-composer-text')).not.toContain('@')
    await page.keyboard.type('@')
    await expect(addMenu).toBeVisible()
    await addMenu.getByTestId('composer-add-option-B').click()
    await expect(composer.getByTestId('composer-tag')).toHaveText('@B')
    await page.keyboard.type(' pin @A')
    await expect(composer.getByTestId('composer-tag')).toHaveText(['@B', '@A'])
    await page.keyboard.type('x')
    await expect(composer.getByTestId('composer-tag')).toHaveText('@B')
    expect(await composer.getAttribute('data-composer-text')).toContain('@Ax')
    await page.keyboard.press('Backspace')
    await expect(composer.getByTestId('composer-tag')).toHaveText(['@B', '@A'])
    await page.keyboard.type(' @ZZ')
    await expect(composer.getByTestId('composer-tag')).toHaveText(['@B', '@A'])
    expect(await composer.getAttribute('data-composer-text')).toContain('@ZZ')
    expect(await composer.getAttribute('data-composer-text')).not.toContain('@Ax')
    await expect(composer.locator('.composer-tag-at')).toHaveCount(0)
    const composerInk = await tagInk(composer.getByTestId('composer-tag').nth(1))
    expect(composerInk.atTop).toBeGreaterThanOrEqual(composerInk.labelTop - 1)
    expect(composerInk.atBottom).toBeGreaterThanOrEqual(composerInk.labelBottom - 0.5)
    expect(Math.abs(composerInk.labelBottom - composerInk.neighborBottom)).toBeLessThan(1.5)

    await page.keyboard.press('Escape')
    await expect(addMenu).toBeHidden()
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
    await expect(dock).toHaveAttribute('data-dock', 'bottom')
    await expect(page.getByTestId('chat-composer-glow')).toHaveCount(0)
    const sent = page.getByTestId('chat-user-message').first()
    await expect(sent.locator('li p').first()).toHaveText('Ship the notes')
    await expect(sent.locator('p code')).toHaveText('notes')
    await expect(sent.locator('.hljs-keyword')).toHaveText('const')
    await expect(sent.getByTestId('composer-code-language')).toHaveText('JavaScript')
    await expect(sent.getByTestId('composer-tag')).toHaveText(['@B', '@A'])
    await expect(sent.locator('h1, h2, h3')).toHaveCount(0)
    await expect(composer).toHaveAttribute('data-composer-text', '')
    await expect(page.getByTestId('model-picker')).toBeHidden()
    await sent.scrollIntoViewIfNeeded()
    const sentDocument = sent.getByRole('document', { name: 'Your message' })
    await expect(sentDocument.getByTestId('composer-tag').first()).toHaveCSS('color', tagColor)
    await expect(sentDocument.locator('.composer-tag-at')).toHaveCount(0)
    const sentInk = await tagInk(sentDocument.getByTestId('composer-tag').nth(1))
    expect(sentInk.atTop).toBeGreaterThanOrEqual(sentInk.labelTop - 1)
    expect(sentInk.atBottom).toBeGreaterThanOrEqual(sentInk.labelBottom - 0.5)
    expect(Math.abs(sentInk.labelBottom - sentInk.neighborBottom)).toBeLessThan(1.5)
    await expect(sentDocument).toContainText('@ZZ')
    await page.screenshot({ path: testInfo.outputPath('composer-sent.png') })
    await sentDocument.screenshot({ path: testInfo.outputPath('composer-sent-document.png') })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
