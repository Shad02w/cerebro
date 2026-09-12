import { _electron as electron, chromium, type ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, expect, electronAppArgs, stopMux } from './fixtures'

const desktopRoot = path.resolve(__dirname, '..')
const require = createRequire(path.join(desktopRoot, 'package.json'))
const electronBinary = require('electron') as unknown as string

// Opt-in benchmark: process-cold launches, not an OS disk-cache-cold benchmark.
test('measures Electron startup with fresh, stopped, and live mux runtimes', async ({}, info) => {
  test.skip(process.env.CEREBRO_BENCH_STARTUP !== '1', 'Opt in with CEREBRO_BENCH_STARTUP=1')
  test.setTimeout(240_000)
  const root = await mkdtemp(path.join(tmpdir(), 'cerebro-boot-'))
  const probe = path.join(root, 'probe.cjs')
  await writeFile(
    probe,
    `const { app, ipcMain } = require('electron');
const start = Number(process.env.CEREBRO_BOOT_START);
const records = global.__cerebroBoot = [];
const mark = (name, extra = {}) => records.push({ name, ms: Date.now() - start, ...extra });
mark('main-entry');
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (...args) => {
  const begin = Date.now();
  try { return await listener(...args); }
  finally { mark(channel, { startMs: begin - start, durationMs: Date.now() - begin }); }
});
const fs = require('node:fs/promises');
const cp = fs.cp;
fs.cp = async (...args) => {
  const begin = Date.now();
  try {
    if (process.env.CEREBRO_BOOT_CLONE_COPY === '1')
      args[2] = { ...args[2], mode: require('node:fs').constants.COPYFILE_FICLONE };
    return await cp(...args);
  }
  finally { mark('runtime-copy', { startMs: begin - start, durationMs: Date.now() - begin }); }
};
const childProcess = require('node:child_process');
const spawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const mux = args[1]?.some(arg => String(arg).endsWith('mux.cjs'));
  if (mux && process.env.CEREBRO_BOOT_EXISTING_NODE) args[0] = process.env.CEREBRO_BOOT_EXISTING_NODE;
  const child = spawn(...args);
  if (mux) {
    mark('mux-spawn-request');
    child.once('spawn', () => mark('mux-spawned'));
  }
  return child;
};
app.on('ready', () => mark('app-ready'));
app.on('browser-window-created', (_, win) => {
  mark('window-created');
  win.on('ready-to-show', () => mark('ready-to-show'));
  win.on('show', () => mark('window-show'));
  for (const event of ['dom-ready', 'did-finish-load'])
    win.webContents.on(event, () => mark(event));
});
require(${JSON.stringify(path.join(desktopRoot, 'out/main/index.js'))});
mark('main-imports-done');
`
  )
  const results: unknown[] = []
  let running: ElectronApplication | undefined
  const homes: string[] = []
  try {
    for (let sample = 0; sample < Number(process.env.CEREBRO_BOOT_SAMPLES ?? 5); sample++) {
      const home = path.join(root, `sample-${sample}`)
      homes.push(home)
      const folder = path.join(home, 'project')
      await mkdir(folder, { recursive: true })
      // Isolate shell startup from the user's dotfiles; measure those separately.
      await writeFile(path.join(home, '.zshrc'), 'PROMPT="BOOT_READY> "\n')
      for (const scenario of ['fresh-empty', 'stopped-terminal', 'live-terminal']) {
        const env = { ...process.env }
        delete env.ELECTRON_RUN_AS_NODE
        delete env.ELECTRON_RENDERER_URL
        delete env.CEREBRO_DB_PATH
        delete env.CEREBRO_MUX_RUNTIME
        const start = Date.now()
        running = await electron.launch({
          executablePath: electronBinary,
          args: [probe, ...electronAppArgs(path.join(home, 'user-data')).slice(1)],
          cwd: desktopRoot,
          env: {
            ...env,
            NODE_ENV: 'test',
            CEREBRO_HOME: home,
            CEREBRO_CLI_TEST_HOME: path.join(home, 'cli-home'),
            CEREBRO_BOOT_START: String(start),
            ZDOTDIR: home,
            SHELL: '/bin/zsh'
          }
        })
        const launchedMs = Date.now() - start
        const page = await running.firstWindow()
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await expect(page.getByTestId('terminal-stack')).toBeAttached()
        await expect(page.getByTestId('startup-splash')).toHaveCount(0)
        await expect(page.getByText(/Mux runtime assets are incomplete/)).toHaveCount(0)
        const contentMs = Date.now() - start
        let terminalMs: number | null = null
        if (scenario !== 'fresh-empty') {
          await expect(page.locator('[data-terminal-session-id]')).toHaveCount(1)
          await expect(page.locator('[data-terminal-status="running"]')).toHaveCount(1)
          // xterm uses canvas. Observe returned PTY output, not nonexistent DOM text.
          const output = page.evaluate(
            () =>
              new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                  remove()
                  reject(new Error('Terminal output timed out'))
                }, 10000)
                let received = ''
                const remove = window.cerebro.onPtyData((event) => {
                  received += event.data
                  if (received.includes('BOOT_INTERACTIVE')) {
                    clearTimeout(timer)
                    remove()
                    resolve()
                  }
                })
              })
          )
          await page.locator('.xterm-helper-textarea').focus()
          await page.keyboard.insertText("printf 'BOOT_%s\\n' INTERACTIVE")
          await page.locator('.xterm-helper-textarea').press('Enter')
          await output
          terminalMs = Date.now() - start
        } else {
          await expect(page.getByText('Create your first project')).toBeVisible()
        }
        const renderer = await page.evaluate(async () => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
          return {
            timeOrigin: performance.timeOrigin,
            navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
            paints: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
            resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON())
          }
        })
        const main = await running.evaluate(
          () => (globalThis as typeof globalThis & { __cerebroBoot: unknown[] }).__cerebroBoot
        )
        const result = {
          sample,
          scenario,
          start,
          launchedMs,
          contentMs,
          terminalMs,
          main,
          renderer,
          errors
        }
        results.push(result)
        console.log(JSON.stringify({ sample, scenario, launchedMs, contentMs, terminalMs, main }))
        expect(errors).toEqual([])
        if (scenario === 'fresh-empty') {
          await page.evaluate(async (directory) => {
            const project = await window.cerebro.createProjectFromDirectory(directory)
            const workspaceId = project.workspaces[0].id
            await window.cerebro.setActiveWorkspace(workspaceId)
            await window.cerebro.layoutCommand({
              target: 'tab',
              action: 'create',
              workspaceId,
              kind: 'terminal'
            })
          }, folder)
          await expect(page.locator('[data-terminal-session-id]')).toHaveCount(1)
        }
        await running.close()
        running = undefined
        if (scenario !== 'stopped-terminal') await stopMux(home)
      }
    }
  } finally {
    await running?.close()
    for (const home of homes) await stopMux(home)
    await info.attach('startup-measurements', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json'
    })
    if (process.env.CEREBRO_BOOT_REPORT)
      await writeFile(process.env.CEREBRO_BOOT_REPORT, JSON.stringify(results, null, 2) + '\n')
    await rm(root, { recursive: true, force: true })
  }
})

test('measures development command to usable Electron content', async ({}, info) => {
  test.skip(process.env.CEREBRO_BENCH_DEV !== '1', 'Opt in with CEREBRO_BENCH_DEV=1')
  test.setTimeout(120_000)
  const home = await mkdtemp(path.join(tmpdir(), 'cerebro-dev-boot-'))
  if (process.env.CEREBRO_BOOT_SEED_DB)
    await copyFile(process.env.CEREBRO_BOOT_SEED_DB, path.join(home, 'cerebro.sqlite'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.CEREBRO_DB_PATH
  delete env.CEREBRO_MUX_RUNTIME
  const start = Date.now()
  const lines: Array<{ ms: number; text: string }> = []
  const child = spawn('pnpm', ['--filter', 'desktop', 'dev'], {
    cwd: path.resolve(desktopRoot, '../..'),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...env,
      NODE_ENV: 'test',
      CEREBRO_HOME: home,
      CEREBRO_CLI_TEST_HOME: path.join(home, 'cli-home'),
      ZDOTDIR: home,
      REMOTE_DEBUGGING_PORT: '0',
      ELECTRON_CLI_ARGS: JSON.stringify(electronAppArgs(path.join(home, 'user-data')).slice(1))
    }
  })
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Development Electron did not start')),
        90_000
      )
      child.once('error', reject)
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Development process exited: ${code}`))
      })
      const receive = (chunk: Buffer): void => {
        const text = chunk.toString()
        lines.push({ ms: Date.now() - start, text })
        const match = text.match(/DevTools listening on (ws:\/\/\S+)/)
        if (match) {
          clearTimeout(timer)
          resolve(match[1])
        }
      }
      child.stdout.on('data', receive)
      child.stderr.on('data', receive)
    })
    // Attach to electron-vite's real Electron process, never a standalone browser.
    const browser = await chromium.connectOverCDP(endpoint)
    try {
      const context = browser.contexts()[0]
      const page = context.pages()[0] ?? (await context.waitForEvent('page'))
      await expect(page.getByTestId('terminal-stack')).toBeAttached({ timeout: 60_000 })
      await expect(page.getByTestId('startup-splash')).toHaveCount(0)
      await expect(page.getByText(/Mux runtime assets are incomplete/)).toHaveCount(0)
      if (process.env.CEREBRO_BOOT_SEED_DB)
        await expect(page.getByTestId(/^project-row-/).first()).toBeVisible()
      else await expect(page.getByText('Create your first project')).toBeVisible()
      const contentMs = Date.now() - start
      expect(await page.evaluate(() => typeof window.cerebro.listProjects)).toBe('function')
      const result = {
        contentMs,
        seeded: Boolean(process.env.CEREBRO_BOOT_SEED_DB),
        renderer: await page.evaluate(() => ({
          timeOrigin: performance.timeOrigin,
          navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
          resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON())
        })),
        lines
      }
      console.log(JSON.stringify({ contentMs, lines }))
      await info.attach('development-startup', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json'
      })
      if (process.env.CEREBRO_BOOT_REPORT)
        await writeFile(process.env.CEREBRO_BOOT_REPORT, JSON.stringify(result, null, 2) + '\n')
      expect(lines.filter((line) => /Mux runtime assets are incomplete/.test(line.text))).toEqual(
        []
      )
    } finally {
      await browser.close()
    }
  } finally {
    if (child.pid && child.exitCode === null) process.kill(-child.pid, 'SIGTERM')
    await stopMux(home)
    await rm(home, { recursive: true, force: true })
  }
})
