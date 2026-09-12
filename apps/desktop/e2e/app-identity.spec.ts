import { expect, test } from './fixtures'

test('local development preserves its explicit data override and development CLI identity', async ({
  electronApp,
  page
}) => {
  test.skip(Boolean(process.env.CEREBRO_E2E_PACKAGED_APP), 'Local development identity only')
  const runtime = await electronApp.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    home: process.env.CEREBRO_HOME,
    nodeEnv: process.env.NODE_ENV
  }))
  expect(runtime.packaged).toBe(false)
  expect(runtime.nodeEnv).toBe('test')
  expect(runtime.home).toContain('cerebro-e2e-')
  const cli = await page.evaluate(() => window.cerebro.getCliStatus())
  expect(cli.command).toBe('cerebro-dev')
  expect(cli.development).toBe(true)
})
