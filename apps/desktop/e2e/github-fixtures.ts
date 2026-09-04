import { access, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  test as base,
  expect,
  type ElectronApplication,
  type Page,
  _electron as electron
} from '@playwright/test'
import { electronAppArgs } from './fixtures'
import { startMockGitHubServer, type MockGitHubServer } from './mock-github'

const desktopRoot = path.resolve(__dirname, '..')
const require = createRequire(path.join(desktopRoot, 'package.json'))
const electronBinary = require('electron') as unknown as string
const mainEntry = path.join(desktopRoot, 'out/main/index.js')

type GitHubFixtures = {
  githubMock: MockGitHubServer
  electronApp: ElectronApplication
  page: Page
}

export const test = base.extend<GitHubFixtures>({
  githubMock: async ({}, use) => {
    const mock = await startMockGitHubServer()
    await use(mock)
    await mock.close()
  },

  electronApp: async ({ githubMock }, use) => {
    try {
      await access(mainEntry)
    } catch {
      throw new Error(
        'Desktop app is not built. Run `pnpm --filter desktop build`, then `pnpm --filter desktop test:e2e:repeat github.spec.ts`.'
      )
    }

    const cerebroHome = await mkdtemp(path.join(tmpdir(), 'cerebro-github-e2e-'))
    const userDataDir = path.join(cerebroHome, 'user-data')

    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL

    const electronApp = await electron.launch({
      executablePath: electronBinary,
      args: electronAppArgs(userDataDir),
      cwd: desktopRoot,
      timeout: 60_000,
      env: {
        ...env,
        NODE_ENV: 'test',
        CEREBRO_HOME: cerebroHome,
        CEREBRO_GITHUB_CLIENT_ID: 'cerebro-e2e-client',
        CEREBRO_GITHUB_LOGIN_URL: githubMock.baseUrl,
        CEREBRO_GITHUB_API_URL: githubMock.baseUrl
      }
    })

    await use(electronApp)
    await electronApp.close()
    await rm(cerebroHome, { recursive: true, force: true })
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  }
})

export { expect }

export async function openIntegrations(page: Page): Promise<void> {
  await page.getByTestId('settings-button').click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/general')
  await page.getByTestId('settings-nav-integrations').click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/integrations')
  await expect(page.getByTestId('settings-integrations')).toBeVisible()
  await expect(page.getByTestId('github-integration-card')).toBeVisible()
}
