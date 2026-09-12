import { test, expect, electronAppArgs, stopMux } from './fixtures'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Project, WorkspaceTab } from '@cerebro/core'
const desktopRoot = resolve(__dirname, '..')
const electronBinary = createRequire(join(desktopRoot, 'package.json'))('electron') as string
const exec = promisify(execFile)

for (const alreadyStopped of [false, true]) {
  test(`Quit Cerebro Completely exits with the mux ${alreadyStopped ? 'already stopped' : 'running'}`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'cerebro-complete-quit-'))
    const directory = join(home, 'folder')
    await mkdir(directory)
    const env = { ...process.env, NODE_ENV: 'test', CEREBRO_HOME: home, SHELL: '/bin/sh' }
    delete env.CEREBRO_DB_PATH
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    const cli = async <T>(...args: string[]): Promise<T> =>
      JSON.parse(
        (await exec(process.execPath, [join(desktopRoot, 'out/cli/cerebro.cjs'), ...args], { env }))
          .stdout
      )
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    let app: ElectronApplication | undefined
    try {
      const project = await cli<Project>('project', 'create', '--directory', directory)
      const ws = String(project.workspaces[0].id)
      const shellPids: number[] = []
      for (let index = 0; index < 2; index++) {
        const tab = await cli<WorkspaceTab>('tab', 'create', '--workspace', ws)
        const pidPath = join(home, `shell-${index}.pid`)
        await cli(
          'pane',
          'send',
          '--workspace',
          ws,
          '--pane',
          String(tab.root.id),
          '--text',
          `printf '%s' "$$" > '${pidPath.replaceAll("'", "'\\''")}'`,
          '--enter'
        )
        await expect.poll(() => readFile(pidPath, 'utf8').catch(() => '')).toMatch(/^\d+$/)
        shellPids.push(Number(await readFile(pidPath, 'utf8')))
        await cli('tab', 'focus', '--workspace', ws, '--tab', String(tab.id))
      }
      const server = await cli<{ pid: number }>('server', 'status')
      app = await electron.launch({
        executablePath: electronBinary,
        args: electronAppArgs(join(home, 'user-data')),
        cwd: desktopRoot,
        env
      })
      const page = await app.firstWindow()
      await expect(page.locator('.terminal-host')).toHaveAttribute(
        'data-terminal-session-id',
        /\d+/
      )
      if (alreadyStopped) {
        await cli('server', 'stop')
        await expect(page.locator('[data-terminal-status]')).toHaveAttribute(
          'data-terminal-status',
          'stopped'
        )
      }
      const closed = app.waitForEvent('close')
      await app.evaluate(({ Menu }) => {
        const menu = Menu.getApplicationMenu()
        const item = menu?.getMenuItemById('quit-cerebro-completely')
        if (!item || item.label !== 'Quit Cerebro Completely')
          throw new Error('Complete quit menu item missing.')
        setTimeout(() => item.click(), 0)
      })
      await closed
      app = undefined
      await expect.poll(() => alive(server.pid)).toBe(false)
      for (const pid of shellPids) await expect.poll(() => alive(pid)).toBe(false)
      expect(await cli('server', 'status')).toEqual({ running: false })
      // Shutdown retains the saved tabs for the next launch.
      expect(await cli<WorkspaceTab[]>('tab', 'list', '--workspace', ws)).toHaveLength(2)
    } finally {
      await app?.close()
      await stopMux(home)
      await rm(home, { recursive: true, force: true })
    }
  })
}

test('Electron quit and reopen reattach to the same running shell and BSP layout', async ({}, testInfo) => {
  const home = await mkdtemp(join(tmpdir(), 'cerebro-mux-electron-'))
  const directory = join(home, 'folder')
  await mkdir(directory)
  const env = { ...process.env, NODE_ENV: 'test', CEREBRO_HOME: home, SHELL: '/bin/sh' }
  delete env.CEREBRO_DB_PATH
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const cli = async <T>(...args: string[]): Promise<T> =>
    JSON.parse(
      (await exec(process.execPath, [join(desktopRoot, 'out/cli/cerebro.cjs'), ...args], { env }))
        .stdout
    )
  let app: ElectronApplication | undefined
  const launch = async (): Promise<ElectronApplication> =>
    electron.launch({
      executablePath: electronBinary,
      args: electronAppArgs(join(home, 'user-data')),
      cwd: desktopRoot,
      env
    })
  try {
    const project = await cli<Project>('project', 'create', '--directory', directory)
    const workspaceId = project.workspaces[0].id
    const ws = String(workspaceId)
    const tab = await cli<WorkspaceTab>('tab', 'create', '--workspace', ws)
    const pane = String(tab.root.id)
    await cli(
      'pane',
      'send',
      '--workspace',
      ws,
      '--pane',
      pane,
      '--text',
      "export MUX_PERSIST=alive; printf '\\n%s\\n' BEFORE_CLOSE",
      '--enter'
    )
    await expect
      .poll(
        async () =>
          (await cli<{ data: string }>('pane', 'capture', '--workspace', ws, '--pane', pane)).data
      )
      .toContain('\nBEFORE_CLOSE\n')
    const before = await cli<{ sessionId: string }>(
      'pane',
      'capture',
      '--workspace',
      ws,
      '--pane',
      pane
    )
    await cli('tab', 'focus', '--workspace', ws, '--tab', String(tab.id))
    app = await launch()
    let page = await app.firstWindow()
    await expect(page.locator(`[data-terminal-pane-id="${pane}"] .xterm`)).toBeVisible()
    await app.close()
    app = undefined
    await cli(
      'pane',
      'send',
      '--workspace',
      ws,
      '--pane',
      pane,
      '--text',
      'printf \'\\n%s\\n\' "after:$MUX_PERSIST"',
      '--enter'
    )
    await expect
      .poll(
        async () =>
          (await cli<{ data: string }>('pane', 'capture', '--workspace', ws, '--pane', pane)).data
      )
      .toContain('after:alive')
    app = await launch()
    page = await app.firstWindow()
    await expect(page.locator(`[data-terminal-pane-id="${pane}"] .xterm`)).toBeVisible()
    const after = await cli<{ sessionId: string }>(
      'pane',
      'capture',
      '--workspace',
      ws,
      '--pane',
      pane
    )
    expect(after.sessionId).toBe(before.sessionId)
    expect((await cli<WorkspaceTab[]>('tab', 'list', '--workspace', ws))[0].id).toBe(tab.id)
    const verifyInput = async (marker: string): Promise<void> => {
      await expect(page.locator(`[data-terminal-pane-id="${pane}"]`)).toHaveAttribute(
        'data-terminal-status',
        'running'
      )
      await page
        .locator(`[data-terminal-pane-id="${pane}"] .xterm-helper-textarea`)
        .pressSequentially(`printf '${marker}\\n'`)
      await page.keyboard.press('Enter')
      await expect
        .poll(
          async () =>
            (await cli<{ data: string }>('pane', 'capture', '--workspace', ws, '--pane', pane)).data
        )
        .toContain(`\n${marker}\n`)
      await expect(page.getByText('Terminal attachment not found.', { exact: false })).toHaveCount(
        0
      )
    }
    await verifyInput('REOPEN_INPUT_OK')
    // Selecting the restored workspace changes the hash without replacing its terminal view.
    await page.getByTestId(`workspace-row-${ws}`).click()
    await expect(page).toHaveURL(/#\/$/)
    await verifyInput('WORKSPACE_INPUT_OK')
    await page.screenshot({ path: testInfo.outputPath('reattached.png') })
    // Reload destroys WebContents subscriptions; input/output must still reconnect.
    await page.reload()
    await expect(page.locator(`[data-terminal-pane-id="${pane}"] .xterm`)).toBeVisible()
    expect(
      (await cli<{ sessionId: string }>('pane', 'capture', '--workspace', ws, '--pane', pane))
        .sessionId
    ).toBe(before.sessionId)
    await expect(page.locator(`[data-terminal-pane-id="${pane}"]`)).toHaveAttribute(
      'data-terminal-status',
      'running'
    )
    await verifyInput('RELOAD_INPUT_OK')
    // Both VTs see this query. Only the authoritative daemon may answer it.
    await cli(
      'pane',
      'send',
      '--workspace',
      ws,
      '--pane',
      pane,
      '--text',
      "stty -echo -icanon min 0 time 2; printf '\\033[5n'; RESPONSE=$(dd bs=1 count=100 2>/dev/null); stty sane; printf '\\nREPLY_BYTES:%s\\n' \"$(printf %s \"$RESPONSE\" | wc -c | tr -d ' ')\"",
      '--enter'
    )
    await expect
      .poll(
        async () =>
          (await cli<{ data: string }>('pane', 'capture', '--workspace', ws, '--pane', pane)).data
      )
      .toContain('REPLY_BYTES:4')
    const oldAttachment = await page
      .locator('.terminal-host')
      .getAttribute('data-terminal-session-id')
    await cli('pane', 'restart', '--workspace', ws, '--pane', pane)
    await expect(page.locator('.terminal-host')).not.toHaveAttribute(
      'data-terminal-session-id',
      oldAttachment!
    )
    await expect(page.locator(`[data-terminal-pane-id="${pane}"]`)).toHaveAttribute(
      'data-terminal-status',
      'running'
    )
    await page
      .locator(`[data-terminal-pane-id="${pane}"] .xterm-helper-textarea`)
      .pressSequentially("printf 'VIEW_RESTART_OK\\n'")
    await page.keyboard.press('Enter')
    await expect
      .poll(
        async () =>
          (await cli<{ data: string }>('pane', 'capture', '--workspace', ws, '--pane', pane)).data
      )
      .toContain('\nVIEW_RESTART_OK\n')
    await cli('server', 'stop')
    await expect(page.locator(`[data-terminal-pane-id="${pane}"]`)).toHaveAttribute(
      'data-terminal-status',
      'stopped'
    )
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(await cli('server', 'status')).toEqual({ running: false })
    await cli('server', 'start')
    await expect(page.locator(`[data-terminal-pane-id="${pane}"]`)).toHaveAttribute(
      'data-terminal-status',
      'running'
    )
  } finally {
    await app?.close()
    await stopMux(home)
    await rm(home, { recursive: true, force: true })
  }
})
