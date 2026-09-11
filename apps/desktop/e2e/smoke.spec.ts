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

  await expect(page.getByTestId('sidebar-brain-mark')).toBeVisible()
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
    const inset = document.querySelector('[data-slot="sidebar-inset"]')
    const sidebar = document.querySelector('[data-slot="sidebar"]')
    if (!overlayEl || !trigger || !inset || !sidebar) {
      throw new Error('Window chrome elements were not found.')
    }

    const overlayBox = overlayEl.getBoundingClientRect()
    const triggerBox = trigger.getBoundingClientRect()
    const insetBox = inset.getBoundingClientRect()
    const sidebarBox = sidebar.getBoundingClientRect()
    const style = getComputedStyle(overlayEl)

    return {
      overlayTop: overlayBox.top,
      overlayLeft: overlayBox.left,
      overlayWidth: overlayBox.width,
      overlayHeight: overlayBox.height,
      overlayPosition: style.position,
      overlayAppRegion:
        style.getPropertyValue('-webkit-app-region') ||
        (style as CSSStyleDeclaration & { webkitAppRegion?: string }).webkitAppRegion ||
        '',
      triggerTop: triggerBox.top,
      triggerHeight: triggerBox.height,
      triggerAppRegion:
        getComputedStyle(trigger).getPropertyValue('-webkit-app-region') ||
        (getComputedStyle(trigger) as CSSStyleDeclaration & { webkitAppRegion?: string })
          .webkitAppRegion ||
        '',
      insetTop: insetBox.top,
      sidebarTop: sidebarBox.top,
      sidebarLeft: sidebarBox.left,
      windowWidth: window.innerWidth
    }
  })

  expect(metrics.overlayPosition).toBe('fixed')
  expect(metrics.overlayTop).toBe(0)
  expect(metrics.overlayLeft).toBe(0)
  expect(metrics.overlayWidth).toBe(metrics.windowWidth)
  expect(metrics.overlayHeight).toBe(44)
  expect(metrics.overlayAppRegion).toBe('drag')
  expect(metrics.triggerAppRegion).toBe('no-drag')
  expect(metrics.triggerHeight).toBe(24)
  expect(Math.round(metrics.triggerTop)).toBe(10)
  expect(Math.round(metrics.triggerTop + metrics.triggerHeight / 2)).toBe(22)
  expect(metrics.insetTop).toBe(0)
  expect(metrics.sidebarTop).toBe(0)
  expect(metrics.sidebarLeft).toBe(0)
})

test('keeps the fixed sidebar trigger visible after collapsing', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Toggle Sidebar' })
  await expect(trigger).toBeVisible()
  await expect(page.getByTestId('titlebar-sidebar-trigger')).toBeVisible()
  await expect(page.getByTestId('sidebar-brain-mark')).toBeVisible()

  await trigger.click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed')
  await expect(trigger).toBeVisible()

  const collapsed = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="titlebar-sidebar-trigger"]')
    const button = document.querySelector('[data-slot="sidebar-trigger"]')
    if (!host || !button) throw new Error('Sidebar trigger was not found.')
    const hostBox = host.getBoundingClientRect()
    const buttonBox = button.getBoundingClientRect()
    const hostStyle = getComputedStyle(host)
    return {
      hostPosition: hostStyle.position,
      hostZ: hostStyle.zIndex,
      hostLeft: hostBox.left,
      buttonWidth: buttonBox.width,
      buttonHeight: buttonBox.height,
      buttonTop: buttonBox.top
    }
  })

  expect(collapsed.hostPosition).toBe('fixed')
  expect(Number(collapsed.hostZ)).toBeGreaterThanOrEqual(60)
  expect(Math.round(collapsed.hostLeft)).toBe(78)
  expect(collapsed.buttonWidth).toBe(24)
  expect(collapsed.buttonHeight).toBe(24)
  expect(Math.round(collapsed.buttonTop)).toBe(10)

  await trigger.click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded')
  await expect(page.getByTestId('sidebar-brain-mark')).toBeVisible()
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
