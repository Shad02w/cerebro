import { test, expect, electronAppArgs, stopMux } from './fixtures'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Project, WorkspaceTab } from '@cerebro/core'
const desktopRoot = resolve(__dirname, '..')
const electronBinary = createRequire(join(desktopRoot, 'package.json'))('electron') as string
const exec = promisify(execFile)
const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`
const osc = (text: string): string => `\x1b]${text}\x1b\\`

for (const renderer of ['auto', 'dom'] as const) {
  test(`mux preserves colors and stable sparkle cursor after reconnect (${renderer})`, async ({}, testInfo) => {
    const home = await mkdtemp(join(tmpdir(), 'cerebro-colors-'))
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
    try {
      const project = await cli<Project>('project', 'create', '--directory', directory)
      const ws = String(project.workspaces[0].id)
      const tab = await cli<WorkspaceTab>('tab', 'create', '--workspace', ws)
      const pane = String(tab.root.id)
      await cli('tab', 'focus', '--workspace', ws, '--tab', String(tab.id))
      app = await electron.launch({
        executablePath: electronBinary,
        args: electronAppArgs(join(home, 'user-data')),
        cwd: desktopRoot,
        env
      })
      const page = await app.firstWindow()
      if (renderer === 'dom') {
        await page.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext
          HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
            if (type === 'webgl' || type === 'webgl2') return null
            return Reflect.apply(original, this, [type, ...args])
          } as typeof original
        })
        await page.reload()
      }
      const host = page.locator(`[data-terminal-pane-id="${pane}"]`)
      await expect(host.locator('.xterm')).toBeVisible()
      if (renderer === 'dom')
        await expect(host.locator('.terminal-host')).toHaveAttribute(
          'data-terminal-renderer',
          'dom'
        )
      const probe = async (name: string, sequences: string, expected: string): Promise<void> => {
        const script = join(home, `${name}.cjs`)
        const result = join(home, `${name}.json`)
        await writeFile(
          script,
          `
        const fs = require('node:fs');
        const chunks = [];
        process.stdin.setRawMode(true);
        process.stdin.on('data', data => chunks.push(data));
        process.stdout.write(${JSON.stringify(sequences)});
        setTimeout(() => {
          fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify(Buffer.concat(chunks).toString()));
          process.stdin.setRawMode(false);
          process.exit();
        }, 700);
      `
        )
        await cli(
          'pane',
          'send',
          '--workspace',
          ws,
          '--pane',
          pane,
          '--text',
          `${quote(process.execPath)} ${quote(script)}`,
          '--enter'
        )
        await expect
          .poll(() => readFile(result, 'utf8').catch(() => ''))
          .toBe(JSON.stringify(expected))
      }
      await probe(
        'default',
        osc('10;?;?;?') + osc('4;1;?;200;?'),
        osc('10;rgb:fafa/fafa/fafa') +
          osc('11;rgb:0a0a/0a0a/0a0a') +
          osc('12;rgb:fafa/fafa/fafa') +
          osc('4;1;rgb:cccc/0000/0000') +
          osc('4;200;rgb:ffff/0000/d7d7')
      )
      await page.evaluate(() => window.cerebro.setSettings({ terminalTheme: 'dracula' }))
      await page.reload()
      await expect(host.locator('.xterm')).toBeVisible()
      await probe(
        'theme',
        osc('10;?;?'),
        osc('10;rgb:f8f8/f8f8/f2f2') + osc('11;rgb:2828/2a2a/3636')
      )
      const overrides = osc('4;1;#123456;200;#abcdef') + osc('10;#ddeeff;#202830;#778899')
      const queries = osc('10;?;?;?') + osc('4;1;?;200;?')
      const expected =
        osc('10;rgb:dddd/eeee/ffff') +
        osc('11;rgb:2020/2828/3030') +
        osc('12;rgb:7777/8888/9999') +
        osc('4;1;rgb:1212/3434/5656') +
        osc('4;200;rgb:abab/cdcd/efef')
      await probe('overrides', overrides + queries, expected)
      await page.reload()
      await expect(host.locator('.xterm')).toBeVisible()
      await probe('restored', queries, expected)
      await expect(host.locator('.xterm-scrollable-element')).toHaveCSS(
        'background-color',
        'rgb(32, 40, 48)'
      )
      const draw = join(home, 'sparkle.cjs')
      const go = join(home, 'animate')
      await writeFile(
        draw,
        `
      const fs = require('node:fs');
      let frame = 0;
      process.stdout.write('\x1b[2J\x1b[H\x1b[?25h\x1b[2 qCURSOR_READY\\r\\nAsk Codex to do anything\\r\\n\x1b[31mIndexed red   \x1b[38;5;200mIndexed 200\x1b[0m\x1b[2;5H');
      const timer = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(go)})) return;
        const dots = frame++ % 2 ? '⠁   ⠂    ⠄   ⠈    ⠐   ⠠' : '⢀    ⡀   ⠠    ⠐   ⠈    ⠄';
        process.stdout.write('\x1b[?2026h\x1b[H\x1b[38;2;128;144;160m\x1b[48;2;32;40;48m' + dots);
        // Force separate PTY chunks with a render opportunity between them.
        setTimeout(() => process.stdout.write('\x1b[0m\x1b[2;5H\x1b[?25h\x1b[?2026l'), 60);
        if (frame === 30) clearInterval(timer);
      }, 150);
    `
      )
      await cli(
        'pane',
        'send',
        '--workspace',
        ws,
        '--pane',
        pane,
        '--text',
        `${quote(process.execPath)} ${quote(draw)}`,
        '--enter'
      )
      const capture = async (): Promise<string> =>
        (await cli<{ data: string }>('pane', 'capture', '--workspace', ws, '--pane', pane)).data
      await expect.poll(capture).toContain('CURSOR_READY')
      const textarea = host.locator('.xterm-helper-textarea')
      await textarea.focus()
      await textarea.evaluate((element) => {
        const position = (): string => `${element.style.left},${element.style.top}`
        const positions = new Set([position()])
        const observer = new MutationObserver(() => positions.add(position()))
        observer.observe(element, { attributes: true, attributeFilter: ['style'] })
        setTimeout(() => {
          observer.disconnect()
          element.dataset.cursorPositions = JSON.stringify([...positions])
        }, 1200)
      })
      await writeFile(go, '')
      await expect(textarea).toHaveAttribute('data-cursor-positions', /./)
      expect(JSON.parse((await textarea.getAttribute('data-cursor-positions'))!)).toHaveLength(1)
      await expect.poll(capture).toContain('⠁   ⠂')
      await expect.poll(capture).toContain('⢀    ⡀')
      await page.screenshot({ path: testInfo.outputPath('terminal-colors-sparkle.png') })
      const ansi = await cli<{ data: string }>(
        'pane',
        'capture',
        '--workspace',
        ws,
        '--pane',
        pane,
        '--format',
        'ansi'
      )
      expect(ansi.data).toContain(osc('4;200;rgb:abab/cdcd/efef'))
      expect(ansi.data).toContain('38;2;128;144;160')
      if (
        renderer === 'auto' &&
        (await host.locator('.terminal-host').getAttribute('data-terminal-renderer')) === 'webgl'
      ) {
        const lost = await host.locator('canvas').evaluateAll((canvases) => {
          for (const canvas of canvases) {
            const gl = canvas.getContext('webgl2')
            const extension = gl?.getExtension('WEBGL_lose_context')
            if (extension) {
              extension.loseContext()
              return true
            }
          }
          return false
        })
        expect(lost).toBe(true)
        await expect(host.locator('.terminal-host')).toHaveAttribute(
          'data-terminal-renderer',
          'dom'
        )
        await expect(host.locator('.xterm-rows')).toContainText('Indexed red')
      }
      // Stopping the isolated daemon checkpoints the palette as well as cells.
      await app.close()
      app = undefined
      await stopMux(env)
      const recovered = await cli<{ data: string }>(
        'pane',
        'capture',
        '--workspace',
        ws,
        '--pane',
        pane,
        '--format',
        'ansi'
      )
      expect(recovered.data).toContain(osc('4;200;rgb:abab/cdcd/efef'))
      expect(recovered.data).toContain(osc('10;rgb:dddd/eeee/ffff'))
    } finally {
      await app?.close()
      await stopMux(env)
      await rm(home, { recursive: true, force: true })
    }
  })
}
