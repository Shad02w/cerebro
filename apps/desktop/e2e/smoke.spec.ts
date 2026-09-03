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
  await expect(
    page.getByText(/Link a Git repository to a workspace. Cerebro clones the default branch into/)
  ).toBeVisible()
  await expect(page.getByText(/SQLite/i)).toHaveCount(0)
})
