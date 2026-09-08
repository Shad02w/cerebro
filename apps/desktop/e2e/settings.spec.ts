import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from './fixtures'

const artifactsDir = process.env.CEREBRO_E2E_ARTIFACTS ?? path.join(tmpdir(), 'cerebro-e2e-artifacts')

test('settings reuses the app sidebar and navigates by hash route', async ({ page }) => {
  await mkdir(artifactsDir, { recursive: true })

  await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Integrations' })).toHaveCount(0)

  const settingsRadius = await page
    .getByTestId('settings-button')
    .evaluate((el) => getComputedStyle(el).borderRadius)

  await page.screenshot({
    path: path.join(artifactsDir, 'workspaces-settings-entry.png'),
    fullPage: true
  })

  await page.getByRole('button', { name: 'Settings' }).click()

  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/general')
  await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
  await expect(page.locator('[data-slot="sidebar-inset"] > header')).toHaveCount(0)
  await expect(page.getByText('No projects yet. Use + to clone a repository or open a folder.')).toHaveCount(0)

  const sidebar = page.locator('[data-slot="sidebar"]')
  const generalNav = sidebar.getByRole('button', { name: 'General' })
  const terminalNav = sidebar.getByRole('button', { name: 'Terminal' })
  const keyboardNav = sidebar.getByRole('button', { name: 'Keyboard' })
  const integrationsNav = sidebar.getByRole('button', { name: 'Integrations' })

  await expect(generalNav).toBeVisible()
  await expect(terminalNav).toBeVisible()
  await expect(keyboardNav).toBeVisible()
  await expect(integrationsNav).toBeVisible()
  await expect(generalNav).toHaveAttribute('data-active', 'true')
  await expect(terminalNav).toHaveAttribute('data-active', 'false')
  const selectedShadow = await generalNav.evaluate((el) => getComputedStyle(el).boxShadow)
  const idleShadow = await terminalNav.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(selectedShadow).not.toBe('none')
  expect(idleShadow).toBe('none')

  const navRadius = await generalNav.evaluate((el) => getComputedStyle(el).borderRadius)
  const backRadius = await page.getByRole('button', { name: 'Back' }).evaluate((el) => getComputedStyle(el).borderRadius)
  expect(settingsRadius).toBe(navRadius)
  expect(backRadius).toBe(navRadius)

  await expect(generalNav.locator('svg')).toHaveCount(1)
  await expect(terminalNav.locator('svg')).toHaveCount(1)
  await expect(keyboardNav.locator('svg')).toHaveCount(1)
  await expect(integrationsNav.locator('svg')).toHaveCount(1)

  const content = page.locator('[data-slot="sidebar-inset"]')
  await expect(content.getByRole('button', { name: 'Terminal' })).toHaveCount(0)
  await expect(content.getByRole('heading', { name: 'General' })).toBeVisible()
  await expect(content.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(content.getByLabel('Default clone location')).toBeVisible()
  await expect(
    content.getByText('New projects are cloned into this folder. Existing checkouts are not moved.')
  ).toBeVisible()
  await expect(content.getByRole('button', { name: 'Choose folder' })).toBeVisible()

  const insetBox = await content.boundingBox()
  const headingBox = await content.getByRole('heading', { name: 'General' }).boundingBox()
  expect(insetBox).toBeTruthy()
  expect(headingBox).toBeTruthy()
  expect(headingBox!.y - insetBox!.y).toBeLessThan(56)

  await page.screenshot({
    path: path.join(artifactsDir, 'settings-general.png'),
    fullPage: true
  })

  await terminalNav.click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/terminal')
  await expect(terminalNav).toHaveAttribute('data-active', 'true')
  await expect(generalNav).toHaveAttribute('data-active', 'false')
  expect(await terminalNav.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  expect(await generalNav.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none')
  await expect(content.getByRole('heading', { name: 'Terminal' })).toBeVisible()
  await expect(page.getByTestId('settings-terminal')).toBeVisible()
  await expect(page.getByTestId('settings-font-size')).toBeVisible()
  await expect(page.getByTestId('settings-font-family')).toBeVisible()

  await page.screenshot({
    path: path.join(artifactsDir, 'settings-terminal.png'),
    fullPage: true
  })

  await keyboardNav.click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/keyboard')
  await expect(keyboardNav).toHaveAttribute('data-active', 'true')
  await expect(content.getByRole('heading', { name: 'Keyboard' })).toBeVisible()
  await expect(page.getByTestId('settings-keyboard')).toBeVisible()
  await expect(page.getByTestId('keybind-row-closeTab')).toBeVisible()
  await expect(page.getByTestId('keybind-row-newTerminal')).toBeVisible()
  await expect(page.getByTestId('keybind-row-openChanges')).toBeVisible()
  await expect(page.getByTestId('keybind-row-toggleSidebar')).toBeVisible()
  await expect(page.getByTestId('keybind-row-toggleDevTools')).toBeVisible()
  await expect(page.getByTestId('keybind-edit-closeTab').getByTestId('shortcut-kbd')).toBeVisible()
  await expect(page.getByTestId('keybind-edit-newTerminal').getByTestId('shortcut-kbd')).toHaveAttribute(
    'data-hotkey',
    'Mod+T'
  )
  await expect(page.getByTestId('keybind-edit-openChanges').getByTestId('shortcut-kbd')).toHaveAttribute(
    'data-hotkey',
    'Mod+Shift+G'
  )

  await page.screenshot({
    path: path.join(artifactsDir, 'settings-keyboard.png'),
    fullPage: true
  })

  await integrationsNav.click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/integrations')
  await expect(content.getByRole('heading', { name: 'Integrations' })).toBeVisible()
  await expect(page.getByTestId('github-integration-card')).toBeVisible()

  await page.screenshot({
    path: path.join(artifactsDir, 'settings-integrations.png'),
    fullPage: true
  })

  await page.getByRole('button', { name: 'Back' }).click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/')
  await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
})

test('persists the default clone location from settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()

  const input = page.getByLabel('Default clone location')
  await expect(input).toBeEnabled()
  await expect(input).not.toHaveValue('')
  await expect(input).not.toHaveValue('Loading…')

  const custom = path.join('/tmp', `cerebro-clone-${Date.now()}`)
  await mkdir(custom, { recursive: true })
  await input.fill(custom)
  await input.blur()
  await expect(input).toBeEnabled()
  await expect(input).toHaveValue(custom)

  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByLabel('Default clone location')).toHaveValue(custom)

  const settings = await page.evaluate(async () => window.cerebro.getSettings())
  expect(settings.defaultCloneDir).toBe(custom)
})

test('persists remapped keyboard shortcuts from settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-nav-keyboard').click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/keyboard')

  const closeEdit = page.getByTestId('keybind-edit-closeTab')
  await expect(closeEdit.getByTestId('shortcut-kbd')).toHaveAttribute('data-hotkey', 'Mod+W')

  await page.evaluate(async () => {
    await window.cerebro.setSettings({ keybinds: { closeTab: 'Mod+Shift+W' } })
  })
  await expect
    .poll(async () => {
      const settings = await page.evaluate(async () => window.cerebro.getSettings())
      return settings.keybinds?.closeTab
    })
    .toBe('Mod+Shift+W')

  // Leave and re-enter settings so useSettings refreshes from disk.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-nav-keyboard').click()
  await expect(page.getByTestId('keybind-edit-closeTab').getByTestId('shortcut-kbd')).toHaveAttribute(
    'data-hotkey',
    'Mod+Shift+W'
  )
  await expect(page.getByTestId('keybind-reset-closeTab')).toBeVisible()
})

test('terminal theme combobox searches, selects by keyboard, and persists', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  const picker = page.getByTestId('settings-terminal-theme')
  await expect(picker).toHaveText('Cerebro Default')
  await picker.click()
  await expect(page.getByRole('option')).toHaveText([
    'Cerebro Default', 'Xterm Default', 'Dracula', 'Nord', 'Catppuccin Mocha',
    'Catppuccin Latte', 'Gruvbox Dark', 'Gruvbox Light', 'Solarized Dark',
    'Solarized Light', 'Tokyo Night', 'One Dark', 'Kanagawa Wave', 'Kanagawa Dragon',
    'Kanagawa Lotus', 'Kanagawabones', 'Vercel'
  ])
  const search = page.getByTestId('settings-terminal-theme-search')
  await search.fill('no such theme')
  await expect(page.getByText('No themes found.')).toBeVisible()
  await search.fill('catppuccin')
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(picker).toHaveText('Catppuccin Latte')
  await page.reload()
  await expect(picker).toHaveText('Catppuccin Latte')
  expect((await page.evaluate(() => window.cerebro.getSettings())).terminalTheme).toBe('catppuccin-latte')
  await picker.click()
  await page.getByTestId('settings-terminal-theme-search').press('Escape')
  await expect(picker).toBeFocused()
  await expect(picker).toHaveText('Catppuccin Latte')
})

test('terminal themes reject invalid updates and recover from invalid stored values', async ({ page, electronApp }) => {
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  const error = await page.evaluate(async () => {
    try { await window.cerebro.setSettings({ terminalTheme: 'unknown' as never }); return '' }
    catch (err) { return String(err) }
  })
  expect(error).toContain('Unknown terminal theme')
  await electronApp.evaluate(async () => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const db = new DatabaseSync(`${process.env.CEREBRO_HOME}/cerebro.sqlite`)
    db.prepare("INSERT INTO app_state (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ terminalTheme: 'unknown' }))
    db.close()
  })
  expect((await page.evaluate(() => window.cerebro.getSettings())).terminalTheme).toBe('cerebro-default')
})

test('terminal theme save errors retain selection and guard concurrent saves', async ({ page, electronApp }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('cerebro:settings:set')
    ;(globalThis as any).themeSaveCalls = 0
    ipcMain.handle('cerebro:settings:set', async () => {
      ;(globalThis as any).themeSaveCalls++
      await new Promise((resolve) => setTimeout(resolve, 1500))
      throw new Error('Theme save failed for test')
    })
  })
  const picker = page.getByTestId('settings-terminal-theme')
  await picker.click()
  await page.getByRole('option', { name: 'Dracula', exact: true }).click()
  await picker.click()
  await page.getByRole('option', { name: 'Nord', exact: true }).click()
  await expect(page.getByText(/Theme save failed for test/)).toBeVisible()
  await expect(picker).toHaveText('Cerebro Default')
  expect(await electronApp.evaluate(() => (globalThis as any).themeSaveCalls)).toBe(1)
})


test('saves the Kanagawa variants and Vercel from the theme picker', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  const picker = page.getByTestId('settings-terminal-theme')
  for (const name of ['Kanagawa Wave', 'Kanagawa Dragon', 'Kanagawa Lotus', 'Kanagawabones', 'Vercel']) {
    await picker.click()
    await page.getByTestId('settings-terminal-theme-search').fill(name)
    await page.getByRole('option', { name, exact: true }).click()
    await expect(picker).toHaveText(name)
    expect((await page.evaluate(() => window.cerebro.getSettings())).terminalTheme).toBe(name.toLowerCase().replaceAll(' ', '-'))
  }
  await page.reload()
  await expect(picker).toHaveText('Vercel')
})
