import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createServer, loadConfigFromFile, type UserConfig } from 'vite'
import { test, expect } from './fixtures'

test('development Electron parses and renders Changes with a module worker', async ({
  electronApp,
  page
}, info) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-dev-diff-'))
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    resolve(__dirname, '../electron.vite.config.ts')
  )
  if (!loaded) throw new Error('Could not load Electron Vite configuration')
  const server = await createServer({
    ...(loaded.config.renderer as UserConfig),
    configFile: false,
    root: resolve(__dirname, '../src/renderer'),
    server: { host: '127.0.0.1', port: 0 },
    clearScreen: false
  })
  try {
    const git = (...args: string[]): Promise<unknown> =>
      promisify(execFile)('git', args, { cwd: root })
    await git('init', '-b', 'main')
    await writeFile(join(root, 'example.ts'), 'export const message = "before"\n')
    await git('add', '.')
    await git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'initial'
    )
    await writeFile(
      join(root, 'example.ts'),
      'export const message = "worker renders successfully"\n'
    )
    await server.listen()
    const url = server.resolvedUrls!.local[0]
    // Navigate the actual Electron BrowserWindow, preserving its preload and IPC.
    await electronApp.evaluate(async ({ BrowserWindow }, target) => {
      await BrowserWindow.getAllWindows()[0].loadURL(target)
    }, url)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByTestId('startup-splash')).toHaveCount(0)
    await page.evaluate(async (directory) => {
      const project = await window.cerebro.createProjectFromDirectory(directory)
      const workspaceId = project.workspaces[0].id
      await window.cerebro.setActiveWorkspace(workspaceId)
      await window.cerebro.layoutCommand({
        target: 'tab',
        action: 'create',
        workspaceId,
        kind: 'changes'
      })
    }, root)
    await expect(page.getByTestId('changes-diff')).toContainText('worker renders successfully', {
      timeout: 20_000
    })
    await expect(page.getByText(/Cannot use import statement outside a module/)).toHaveCount(0)
    expect(errors).toEqual([])
    await page.screenshot({ path: info.outputPath('development-changes.png') })
  } finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
