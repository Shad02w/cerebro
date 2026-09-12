import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { getReleaseIdentity } from '../src/shared/release-identity'

async function main(): Promise<void> {
  const identity = getReleaseIdentity(process.argv[2] ?? 'production')
  const output = resolve('dist', identity.channel)
  const appDirectory = process.arch === 'x64' ? 'mac' : `mac-${process.arch}`
  assert.ok(existsSync(join(output, appDirectory)), 'Missing packaged macOS app')
  const bundle = join(output, appDirectory, `${identity.productName}.app`)
  const bundleId = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleIdentifier', join(bundle, 'Contents/Info.plist')],
    { encoding: 'utf8' }
  ).trim()
  assert.equal(bundleId, identity.appId)
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
      executablePath: join(bundle, 'Contents/MacOS', identity.productName),
      args: [`--user-data-dir=${join(home, 'electron')}`],
      env,
      timeout: 30_000
    })
    assert.deepEqual(
      await application.evaluate(({ app }) => ({ name: app.getName(), packaged: app.isPackaged })),
      { name: identity.productName, packaged: true }
    )
    const page = await application.firstWindow()
    await expect(page.getByTestId('sidebar-heading')).toBeVisible({ timeout: 30_000 })
    const cli = await page.evaluate(() => window.cerebro.getCliStatus())
    assert.equal(cli.command, identity.cliCommand)
    assert.equal(cli.development, identity.channel === 'dev')
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
    console.log(`Verified ${identity.productName}: ${bundleId}, Electron window, CLI, mux`)
  } finally {
    await application?.close()
    try {
      execFileSync(
        join(runtime, 'node'),
        ['--no-warnings', join(runtime, 'cerebro.cjs'), 'server', 'stop'],
        { env, timeout: 10_000, stdio: 'pipe' }
      )
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
