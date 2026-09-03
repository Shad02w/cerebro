import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './fixtures'

const artifactsDir = '/opt/cursor/artifacts'

test('settings reuses the app sidebar with icons and a back button', async ({ page }) => {
  await mkdir(artifactsDir, { recursive: true })

  await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()

  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/general')
  await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
  await expect(page.locator('[data-slot="sidebar-inset"] > header')).toHaveCount(0)

  const generalNav = page.getByRole('button', { name: 'General' })
  const terminalNav = page.getByRole('button', { name: 'Terminal' })
  const integrationsNav = page.getByRole('button', { name: 'Integrations' })

  await expect(generalNav).toBeVisible()
  await expect(terminalNav).toBeVisible()
  await expect(integrationsNav).toBeVisible()
  await expect(generalNav.locator('svg')).toHaveCount(1)
  await expect(terminalNav.locator('svg')).toHaveCount(1)
  await expect(integrationsNav.locator('svg')).toHaveCount(1)

  const content = page.locator('[data-slot="sidebar-inset"]')
  await expect(content.getByRole('button', { name: 'Terminal' })).toHaveCount(0)
  await expect(content.getByRole('heading', { name: 'General' })).toBeVisible()
  await expect(content.getByLabel('Default clone location')).toBeVisible()
  await expect(content.getByRole('button', { name: 'Choose folder' })).toBeVisible()

  const insetBox = await content.boundingBox()
  const headingBox = await content.getByRole('heading', { name: 'General' }).boundingBox()
  expect(insetBox).toBeTruthy()
  expect(headingBox).toBeTruthy()
  expect(headingBox!.y - insetBox!.y).toBeLessThan(80)

  await page.screenshot({
    path: path.join(artifactsDir, 'settings-general.png'),
    fullPage: true
  })

  await terminalNav.click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/terminal')
  await expect(content.getByRole('heading', { name: 'Terminal' })).toBeVisible()
  await expect(content.getByText('This section is not available yet.')).toBeVisible()

  await page.screenshot({
    path: path.join(artifactsDir, 'settings-terminal.png'),
    fullPage: true
  })

  await integrationsNav.click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/integrations')
  await expect(content.getByRole('heading', { name: 'Integrations' })).toBeVisible()

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
