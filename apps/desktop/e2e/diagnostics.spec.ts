import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { test, expect } from './fixtures'

const exec = promisify(execFile)
const cliEntry = resolve(__dirname, '../out/cli/cerebro.cjs')
const PRIVATE_NAME = 'very-private-project-name'

async function unzipText(zip: string, entry: string): Promise<string> {
  return (await exec('unzip', ['-p', zip, entry], { maxBuffer: 16 * 1024 * 1024 })).stdout
}
async function entries(zip: string): Promise<string[]> {
  return (await exec('unzip', ['-Z1', zip])).stdout.trim().split('\n').sort()
}

test.describe('diagnostics export', () => {
  test('Settings exports a redacted bundle that explains the running mux', async ({
    electronApp,
    page
  }) => {
    const home = await electronApp.evaluate(() => process.env.CEREBRO_HOME as string)
    const env = { ...process.env, CEREBRO_HOME: home, SHELL: '/bin/sh' }
    delete env.CEREBRO_DB_PATH
    const folder = join(home, PRIVATE_NAME)
    await mkdir(folder)
    await exec(process.execPath, [cliEntry, 'project', 'create', '--directory', folder], { env })
    await expect(page.getByText(PRIVATE_NAME).first()).toBeVisible()

    const target = join(home, 'exported.zip')
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
    }, target)

    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-diagnostics').click()
    await expect(page.getByTestId('settings-diagnostics')).toBeVisible()
    await expect(page.getByText('Never included')).toBeVisible()
    await page.getByTestId('diagnostics-export').click()

    await expect(page.getByTestId('diagnostics-result')).toContainText('Saved')
    await expect(page.getByTestId('diagnostics-result')).not.toContainText('was not running')
    await expect(page.getByTestId('settings-diagnostics')).toContainText(target)
    await page.screenshot({ path: '/tmp/diagnostics-settings.png' })

    expect(await entries(target)).toEqual([
      'README.txt',
      'layout-summary.json',
      'logs/server.log',
      'system.json'
    ])
    const system = JSON.parse(await unzipText(target, 'system.json'))
    expect(system.app.source).toBe('desktop')
    expect(system.mux.running).toBe(true)
    expect(system.ownership).toMatchObject({ recorded: true, alive: true, reachable: true })
    const layout = JSON.parse(await unzipText(target, 'layout-summary.json'))
    expect(layout).toMatchObject({ projects: 1, workspaces: 1, workspacesMissingOnDisk: 0 })
    const log = await unzipText(target, 'logs/server.log')
    expect(log).toContain('"event":"desktop.ready"')
    expect(log).toContain('"event":"server.listening"')

    for (const name of ['README.txt', 'system.json', 'layout-summary.json', 'logs/server.log']) {
      const text = await unzipText(target, name)
      expect(text, name).not.toContain(PRIVATE_NAME)
      expect(text, name).not.toContain(home)
    }
    expect(await readFile(join(home, 'mux/server.log'), 'utf8')).toContain('diagnostics.exported')
  })

  test('canceling the save dialog writes nothing; Help menu and CLI export too', async ({
    electronApp,
    page
  }) => {
    const home = await electronApp.evaluate(() => process.env.CEREBRO_HOME as string)
    const env = { ...process.env, CEREBRO_HOME: home, SHELL: '/bin/sh' }
    delete env.CEREBRO_DB_PATH

    await electronApp.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as never
    })
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-diagnostics').click()
    await page.getByTestId('diagnostics-export').click()
    await expect(page.getByTestId('diagnostics-export')).toHaveText('Export diagnostics…')
    await expect(page.getByTestId('diagnostics-result')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)

    const fromMenu = join(home, 'from-menu.zip')
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
    }, fromMenu)
    await electronApp.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()!.getMenuItemById('export-diagnostics')!.click()
    })
    await expect.poll(async () => (await entries(fromMenu).catch(() => [])).length).toBe(4)

    const fromCli = join(home, 'from-cli.zip')
    const printed = JSON.parse(
      (
        await exec(process.execPath, [cliEntry, 'diagnostics', 'export', '--output', fromCli], {
          env
        })
      ).stdout
    )
    expect(printed).toMatchObject({ path: fromCli, muxRunning: true })
    expect(JSON.parse(await unzipText(fromCli, 'system.json')).app.source).toBe('cli')
    await expect(
      exec(process.execPath, [cliEntry, 'diagnostics', 'export', '--bogus'], { env })
    ).rejects.toMatchObject({ code: 2 })
  })
})
