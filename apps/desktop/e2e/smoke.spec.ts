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
    () => typeof window.cerebro?.listWorkspaces === 'function'
  )
  expect(hasPreloadApi).toBe(true)

  await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible()
  await expect(page.getByText('No workspaces yet. Use + to clone a Git repository.')).toBeVisible()
  await expect(page.getByText('Link a Git repository to a workspace.')).toBeVisible()
  await expect(page.getByText(/default branch into/i)).toHaveCount(0)

  await page.getByRole('button', { name: 'Add workspace' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Add workspace' })).toBeVisible()
  await expect(dialog.getByText(/clone the default branch into/i)).toBeVisible()
  await expect(dialog.getByText('~/cerebro')).toBeVisible()
})
