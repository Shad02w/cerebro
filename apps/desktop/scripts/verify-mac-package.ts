import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect } from '@playwright/test'

async function main(): Promise<void> {
  const output = resolve('dist/production')
  const appDirectory = process.arch === 'x64' ? 'mac' : `mac-${process.arch}`
  assert.ok(existsSync(join(output, appDirectory)), 'Missing packaged macOS app')
  const bundle = join(output, appDirectory, 'Cerebro.app')
  const bundleId = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleIdentifier', join(bundle, 'Contents/Info.plist')],
    { encoding: 'utf8' }
  ).trim()
  assert.equal(bundleId, 'com.cerebro.app')
  const home = mkdtempSync(join(tmpdir(), 'cerebro-package-'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CEREBRO_HOME: home,
    CEREBRO_DB_PATH: join(home, 'cerebro.sqlite')
  }
  delete env.ELECTRON_RUN_AS_NODE
  const runtime = join(bundle, 'Contents/Resources/cli')
  const runtimeMetadata = JSON.parse(readFileSync(join(runtime, 'runtime.json'), 'utf8'))
  assert.equal(runtimeMetadata.platform, 'darwin')
  assert.equal(runtimeMetadata.arch, process.arch)
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    application = await electron.launch({
      executablePath: join(bundle, 'Contents/MacOS', 'Cerebro'),
      args: [`--user-data-dir=${join(home, 'electron')}`],
      env,
      timeout: 30_000
    })
    assert.deepEqual(
      await application.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        home: process.env.CEREBRO_HOME
      })),
      { packaged: true, home }
    )
    const page = await application.firstWindow()
    await expect(page.getByTestId('sidebar-heading')).toBeVisible({ timeout: 30_000 })
    const cli = await page.evaluate(() => window.cerebro.getCliStatus())
    assert.equal(cli.command, 'cerebro')
    assert.equal(cli.development, false)
    const version = await application.evaluate(({ app }) => app.getVersion())
    assert.equal(runtimeMetadata.version, version)
    assert.equal(
      execFileSync(join(runtime, 'node'), [join(runtime, 'cerebro.cjs'), '--version'], {
        env,
        encoding: 'utf8'
      }).trim(),
      version
    )
    const projects = JSON.parse(
      execFileSync(
        join(runtime, 'node'),
        ['--no-warnings', join(runtime, 'cerebro.cjs'), 'project', 'list'],
        { env, encoding: 'utf8', timeout: 20_000 }
      )
    )
    assert.ok(Array.isArray(projects.projects), 'Packaged CLI must connect to its mux')
    console.log(`Verified Cerebro: ${bundleId}, Electron window, CLI, mux`)
  } finally {
    await application?.close()
    try {
      const status = JSON.parse(
        execFileSync(
          join(runtime, 'node'),
          ['--no-warnings', join(runtime, 'cerebro.cjs'), 'server', 'status'],
          { env, timeout: 10_000, encoding: 'utf8' }
        )
      )
      if (status.running) {
        execFileSync(
          join(runtime, 'node'),
          ['--no-warnings', join(runtime, 'cerebro.cjs'), 'server', 'stop'],
          { env, timeout: 10_000, stdio: 'pipe' }
        )
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
