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
