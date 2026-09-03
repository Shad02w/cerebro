import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from './fixtures'

const artifactsDir = process.env.CEREBRO_E2E_ARTIFACTS ?? path.join(tmpdir(), 'cerebro-e2e-artifacts')

test('settings reuses the app sidebar and navigates by hash route', async ({ page }) => {
  await mkdir(artifactsDir, { recursive: true })

  await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Integrations' })).toHaveCount(0)

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
  await expect(page.getByText('No workspaces yet. Use + to clone a Git repository.')).toHaveCount(0)

  const sidebar = page.locator('[data-slot="sidebar"]')
  const generalNav = sidebar.getByRole('button', { name: 'General' })
  const terminalNav = sidebar.getByRole('button', { name: 'Terminal' })
  const integrationsNav = sidebar.getByRole('button', { name: 'Integrations' })

  await expect(generalNav).toBeVisible()
  await expect(terminalNav).toBeVisible()
  await expect(integrationsNav).toBeVisible()
  await expect(generalNav.locator('svg')).toHaveCount(1)
  await expect(terminalNav.locator('svg')).toHaveCount(1)
  await expect(integrationsNav.locator('svg')).toHaveCount(1)

  const content = page.locator('[data-slot="sidebar-inset"]')
  await expect(content.getByRole('button', { name: 'Terminal' })).toHaveCount(0)
  await expect(content.getByRole('heading', { name: 'General' })).toBeVisible()
  await expect(content.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
  await expect(content.getByLabel('Default clone location')).toBeVisible()
  await expect(
    content.getByText('New workspaces are cloned into this folder. Existing checkouts are not moved.')
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
  await expect(content.getByRole('heading', { name: 'Terminal' })).toBeVisible()
  await expect(page.getByTestId('settings-terminal')).toBeVisible()
  await expect(page.getByTestId('settings-font-size')).toBeVisible()
  await expect(page.getByTestId('settings-font-family')).toBeVisible()

  await page.screenshot({
    path: path.join(artifactsDir, 'settings-terminal.png'),
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
  await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible()
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
