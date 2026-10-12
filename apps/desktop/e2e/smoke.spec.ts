import { expect, test } from './fixtures'

test('launches the real Electron window with preload and empty state', async ({
  electronApp,
  page
}) => {
  const isPackaged = await electronApp.evaluate(({ app }) => app.isPackaged)
  expect(isPackaged).toBe(false)

  expect(page.url()).toMatch(/^file:\/\//)

  await expect(page).toHaveTitle('Cerebro')

  const hasPreloadApi = await page.evaluate(
    () => typeof window.cerebro?.listProjects === 'function'
  )
  expect(hasPreloadApi).toBe(true)

  await expect(page.getByTestId('sidebar-heading')).toBeVisible()
  await expect(page.getByTestId('brain-mark')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible()
  await expect(
    page.getByText('No projects yet. Use + to clone a repository or open a folder.')
  ).toBeVisible()
  await expect(
    page.getByText(
      'Clone a Git repository or open a folder to create a project and open a workspace'
    )
  ).toBeVisible()
  await expect(page.getByText(/default branch into/i)).toHaveCount(0)

  const addProject = page
    .locator('[data-slot="sidebar"]')
    .getByRole('button', { name: 'Add project' })
  await addProject.hover()
  await expect(page.getByRole('tooltip', { name: 'Add project' })).toBeVisible()

  await addProject.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Add project' })).toBeVisible()
  await expect(dialog).toContainText('clone the default branch into')
  await expect(dialog.locator('code')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Choose folder' })).toBeVisible()
  const clone = dialog.getByRole('button', { name: 'Clone repository' })
  await dialog.getByLabel('Git URL').fill('')
  await expect(clone).toBeEnabled()
  await clone.click()
  await expect(dialog.getByText('Enter a Git URL, or choose a folder.')).toBeVisible()
  await expect(clone).toBeEnabled()
})

test('window drag overlay spans the top without taking layout space', async ({ page }) => {
  const overlay = page.getByTestId('window-drag-overlay')
  await expect(overlay).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible()
  await expect(page.locator('[data-testid="content-drag-header"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="sidebar-inset"] > header')).toHaveCount(0)

  const metrics = await page.evaluate(() => {
    const overlayEl = document.querySelector('[data-testid="window-drag-overlay"]')
    const trigger = document.querySelector('[data-slot="sidebar-trigger"]')
    if (!overlayEl || !trigger) {
      throw new Error('Window chrome elements were not found.')
    }

    const style = getComputedStyle(overlayEl)
    const triggerStyle = getComputedStyle(trigger)
    const region = (computed: CSSStyleDeclaration): string =>
      computed.getPropertyValue('-webkit-app-region') ||
      (computed as CSSStyleDeclaration & { webkitAppRegion?: string }).webkitAppRegion ||
      ''

    return {
      overlayPosition: style.position,
      overlayAppRegion: region(style),
      triggerAppRegion: region(triggerStyle)
    }
  })

  expect(metrics.overlayPosition).toBe('fixed')
  expect(metrics.overlayAppRegion).toBe('drag')
  expect(metrics.triggerAppRegion).toBe('no-drag')
})

test('keeps the fixed sidebar trigger visible after collapsing', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Toggle Sidebar' })
  await expect(trigger).toBeVisible()
  await expect(page.getByTestId('titlebar-sidebar-trigger')).toBeVisible()
  await expect(page.getByTestId('sidebar-heading')).toBeVisible()

  await trigger.click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed')
  await expect(trigger).toBeVisible()

  const collapsed = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="titlebar-sidebar-trigger"]')
    if (!host) throw new Error('Sidebar trigger was not found.')
    const hostStyle = getComputedStyle(host)
    return {
      hostPosition: hostStyle.position,
      hostZ: hostStyle.zIndex
    }
  })

  expect(collapsed.hostPosition).toBe('fixed')
  expect(Number(collapsed.hostZ)).toBeGreaterThanOrEqual(60)

  await trigger.click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded')
  await expect(page.getByTestId('sidebar-heading')).toBeVisible()
})

test('macOS application menu omits Developer Tools in production builds', async ({
  electronApp
}) => {
  test.skip(process.platform !== 'darwin', 'application menu is macOS-only')

  const viewRoles = await electronApp.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    const view = menu?.items.find((item) => item.label === 'View')
    return (view?.submenu?.items ?? []).map((item) => item.role ?? item.label)
  })

  expect(viewRoles.map((role) => role?.toLowerCase())).not.toContain('toggledevtools')
})

test('loads the supplied neurology artwork and native app icon', async ({
  electronApp,
  page
}, info) => {
  const mark = page.getByTestId('brain-mark')
  await expect(mark).toBeVisible()
  await expect(mark.locator('path')).toHaveAttribute('fill', 'currentColor')
  await expect(mark.locator('path')).toHaveAttribute('d', /^M14\.25 21q/)
  await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible()
  expect(await mark.evaluate((element) => getComputedStyle(element).color)).not.toBe('rgb(0, 0, 0)')
  const icon = await electronApp.evaluate(({ app, nativeImage }) => {
    const image = nativeImage.createFromPath(`${app.getAppPath()}/resources/icon.png`)
    const bitmap = image.toBitmap()
    const alpha = (x: number, y: number): number => bitmap[(y * 1024 + x) * 4 + 3]
    const pixel = (x: number, y: number): number[] =>
      Array.from(bitmap.subarray((y * 1024 + x) * 4, (y * 1024 + x) * 4 + 4))
    return {
      empty: image.isEmpty(),
      size: image.getSize(),
      alpha: [alpha(0, 0), alpha(64, 64), alpha(512, 32), alpha(512, 80)],
      colors: {
        foreground: pixel(400, 512),
        background: pixel(512, 512)
      }
    }
  })
  expect(icon).toEqual({
    empty: false,
    size: { width: 1024, height: 1024 },
    alpha: [0, 0, 0, 255],
    colors: {
      foreground: [255, 255, 255, 255],
      background: [0, 0, 0, 255]
    }
  })
  await page.screenshot({ path: info.outputPath('cerebro-branding.png') })
})
