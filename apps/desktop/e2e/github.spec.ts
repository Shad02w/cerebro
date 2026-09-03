import { expect, openIntegrations, test } from './github-fixtures'

test('connects to GitHub via device flow', async ({ page, githubMock }) => {
  await openIntegrations(page)
  await expect(page.getByTestId('github-connect')).toBeVisible()

  await page.getByTestId('github-connect').click()
  await expect(page.getByTestId('github-pending')).toBeVisible()
  await expect(page.getByTestId('github-user-code')).toHaveText(githubMock.lastUserCode() ?? '')

  githubMock.authorize()

  await expect(page.getByTestId('github-connected')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('github-login')).toHaveText('octocat')
  await expect(page.getByTestId('github-disconnect')).toBeVisible()
})

test('cancels a pending device flow', async ({ page }) => {
  await openIntegrations(page)

  await page.getByTestId('github-connect').click()
  await expect(page.getByTestId('github-pending')).toBeVisible()
  await expect(page.getByTestId('github-user-code')).toBeVisible()

  await page.getByTestId('github-cancel').click()
  await expect(page.getByTestId('github-connect')).toBeVisible()
  await expect(page.getByTestId('github-pending')).toHaveCount(0)

  const status = await page.evaluate(async () => window.cerebro.getGitHubStatus())
  expect(status.state).toBe('disconnected')
})

test('disconnects and reconnects with a new device code', async ({ page, githubMock }) => {
  await openIntegrations(page)

  await page.getByTestId('github-connect').click()
  await expect(page.getByTestId('github-pending')).toBeVisible()
  const firstCode = await page.getByTestId('github-user-code').innerText()
  expect(firstCode).toBe(githubMock.lastUserCode())

  githubMock.authorize()
  await expect(page.getByTestId('github-login')).toHaveText('octocat', { timeout: 15_000 })

  await page.getByTestId('github-disconnect').click()
  await expect(page.getByTestId('github-connect')).toBeVisible()

  await page.getByTestId('github-connect').click()
  await expect(page.getByTestId('github-pending')).toBeVisible()
  const secondCode = await page.getByTestId('github-user-code').innerText()
  expect(secondCode).toBe(githubMock.lastUserCode())
  expect(secondCode).not.toBe(firstCode)

  githubMock.authorize()
  await expect(page.getByTestId('github-login')).toHaveText('octocat', { timeout: 15_000 })

  await page.getByTestId('github-disconnect').click()
  await expect(page.getByTestId('github-connect')).toBeVisible()

  const status = await page.evaluate(async () => window.cerebro.getGitHubStatus())
  expect(status.state).toBe('disconnected')
})
