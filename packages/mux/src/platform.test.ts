import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { connectMux, type TerminalSnapshot } from './client'
import type { Project, WorkspaceTab } from '@cerebro/core'

test(
  'bundled native PTY starts, retains output, and restarts on this platform',
  { timeout: 60000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), 'cerebro-mux-platform-'))
    const before = {
      CEREBRO_HOME: process.env.CEREBRO_HOME,
      CEREBRO_DB_PATH: process.env.CEREBRO_DB_PATH,
      SHELL: process.env.SHELL
    }
    process.env.CEREBRO_HOME = home
    delete process.env.CEREBRO_DB_PATH
    if (process.platform !== 'win32') process.env.SHELL = '/bin/sh'
    const folder = join(home, 'project')
    await mkdir(folder)
    const client = await connectMux({
      runtimeDir: resolve(__dirname, '../../../apps/desktop/out/cli')
    })
    try {
      await assert.rejects(
        client.request('hello', { version: 1 }),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'conflict'
      )
      const project = await client.request<Project>('registry', {
        action: 'project.createDirectory',
        directory: folder
      })
      const workspaceId = project.workspaces[0].id
      const created = await client.request<{ result: WorkspaceTab }>('layout.command', {
        target: 'tab',
        action: 'create',
        workspaceId,
        kind: 'terminal'
      })
      const target = { workspaceId, paneId: created.result.root.id }
      const snapshot = await client.request<TerminalSnapshot>('terminal.attach', target)
      assert.equal(snapshot.status, 'running', snapshot.error)
      await client.request('terminal.write', { ...target, data: 'echo MUX_PLATFORM_READY\r' })
      let captured: TerminalSnapshot | undefined
      for (let i = 0; i < 200; i++) {
        captured = await client.request<TerminalSnapshot>('terminal.capture', target)
        if (captured.data.includes('\nMUX_PLATFORM_READY\n')) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.ok(captured?.data.includes('\nMUX_PLATFORM_READY\n'), captured?.data)
      const restarted = await client.request<TerminalSnapshot>('terminal.restart', target)
      assert.equal(restarted.status, 'running', restarted.error)
      assert.notEqual(restarted.sessionId, snapshot.sessionId)
    } finally {
      const stopped = new Promise<void>((resolve) => client.once('disconnected', resolve))
      await client.request('server.stop')
      await stopped
      client.close()
      await rm(home, { recursive: true, force: true, maxRetries: 3 })
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }
)
