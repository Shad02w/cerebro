import { access, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  test as base,
  type ElectronApplication,
  type Page,
  _electron as electron
} from '@playwright/test'

const desktopRoot = path.resolve(__dirname, '..')
const require = createRequire(path.join(desktopRoot, 'package.json'))
const electronBinary = require('electron') as unknown as string
const mainEntry = path.join(desktopRoot, 'out/main/index.js')

export function electronAppArgs(userDataDir: string): string[] {
  const args = ['.', `--user-data-dir=${userDataDir}`]
  if (process.env.HEADED !== '1') {
    args.push('--headless')
  }
  if (process.env.CI) {
    args.push('--no-sandbox', '--disable-gpu')
  }
  return args
}

type Fixtures = {
  electronApp: ElectronApplication
  page: Page
}

export const test = base.extend<Fixtures>({
  electronApp: async ({}, use) => {
    try {
      await access(mainEntry)
    } catch {
      throw new Error(
        'Desktop app is not built. Run `pnpm --filter desktop build`, then `pnpm --filter desktop test:e2e:repeat smoke.spec.ts`.'
      )
    }

    const cerebroHome = await mkdtemp(path.join(tmpdir(), 'cerebro-e2e-'))
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
        CEREBRO_HOME: cerebroHome
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

export { expect } from '@playwright/test'
