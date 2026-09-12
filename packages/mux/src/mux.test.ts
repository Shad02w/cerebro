import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { connectMux, type TerminalSnapshot, type MuxClient } from './client'
import type { Project, WorkspaceTab, Workspace } from '@cerebro/core'
import { VtBoundary } from './vt-boundary'

const exec = promisify(execFile)
const runtimeDir = resolve(__dirname, '../../../apps/desktop/out/cli')
const cliEntry = join(runtimeDir, 'cerebro.cjs')
async function until<T>(fn: () => Promise<T>, check: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await fn()
    if (check(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Condition timed out.')
}

test('VT boundaries retain partial escape sequences and Unicode', () => {
  const boundary = new VtBoundary()
  assert.equal(boundary.take('hello\x1b['), 'hello')
  assert.equal(boundary.take('31mred'), '\x1b[31mred')
  assert.equal(boundary.take('\x1b]7;file:///tmp'), '')
  assert.equal(boundary.take('\x1b\\'), '\x1b]7;file:///tmp\x1b\\')
  assert.equal(boundary.take('\ud83d'), '')
  assert.equal(boundary.take('\ude00'), '😀')
})

test(
  'headless CLI, live reconnect, persistent BSP IDs, crash recovery, and stale input',
  { timeout: 60000, skip: process.platform === 'win32' },
  async () => {
    const home = await mkdtemp(join(tmpdir(), 'cerebro-mux-test-'))
    const directory = join(home, 'project')
    await mkdir(directory)
    const previous = process.env.CEREBRO_HOME
    process.env.CEREBRO_HOME = home
    const previousShell = process.env.SHELL
    process.env.SHELL = '/bin/sh'
    let client: MuxClient | undefined
    const cli = async (...args: string[]): Promise<unknown> =>
      JSON.parse(
        (
          await exec(process.execPath, [cliEntry, ...args], {
            env: { ...process.env, CEREBRO_MUX_RUNTIME: runtimeDir }
          })
        ).stdout
      )
    try {
      assert.deepEqual(await cli('server', 'status'), { running: false })
      const starters = await Promise.all(
        Array.from({ length: 8 }, () => connectMux({ runtimeDir }))
      )
      const pids = await Promise.all(
        starters.map((peer) => peer.request<{ pid: number }>('server.status'))
      )
      assert.equal(new Set(pids.map((status) => status.pid)).size, 1)
      for (const peer of starters) peer.close()
      const project = (await cli('project', 'create', '--directory', directory)) as Project
      const workspaceId = project.workspaces[0].id
      const tab = (await cli('tab', 'create', '--workspace', String(workspaceId))) as WorkspaceTab
      const paneId = tab.root.id
      client = await connectMux({ runtimeDir })
      const target = { workspaceId, paneId }
      let snapshot = await client.request<TerminalSnapshot>('terminal.capture', target)
      assert.equal(snapshot.status, 'running', snapshot.error)
      await client.request('terminal.write', {
        ...target,
        data: "export MUX_TOKEN=kept; printf '\\n%s\\n' 'MUX_READY'\r"
      })
      snapshot = await until(
        () => client!.request<TerminalSnapshot>('terminal.capture', target),
        (value) => value.data.includes('\nMUX_READY\n')
      )
      const generation = snapshot.sessionId
      client.close()
      client = await connectMux({ runtimeDir })
      const attached = await client.request<TerminalSnapshot>('terminal.attach', target)
      assert.equal(attached.sessionId, generation)
      await client.request('terminal.write', {
        ...target,
        sessionId: generation,
        data: 'printf \'\\n%s\\n\' "token:$MUX_TOKEN"\r'
      })
      await until(
        () => client!.request<TerminalSnapshot>('terminal.capture', target),
        (value) => value.data.includes('token:kept')
      )
      const added = (await cli(
        'pane',
        'split',
        '--workspace',
        String(workspaceId),
        '--pane',
        String(paneId),
        '--kind',
        'changes',
        '--direction',
        'down'
      )) as { id: number; kind: string }
      assert.equal(added.kind, 'changes')
      const layout = await cli('tab', 'list', '--workspace', String(workspaceId))
      await assert.rejects(
        client.request('terminal.write', { ...target, sessionId: 'old', data: 'bad' }),
        /session has changed/
      )
      const beforeFlush = await client.request<TerminalSnapshot>('terminal.capture', target)
      await new Promise((resolve) => setTimeout(resolve, 1300))
      const flushed = await client.request<TerminalSnapshot>('terminal.capture', target)
      assert.ok((flushed.durableSequence ?? -1) >= beforeFlush.sequence)
      const status = await client.request<{ pid: number }>('server.status')
      client.close()
      process.kill(status.pid, 'SIGKILL')
      await new Promise((resolve) => setTimeout(resolve, 150))
      client = await connectMux({ runtimeDir })
      const recovered = await client.request<TerminalSnapshot>('terminal.capture', target)
      assert.equal(recovered.status, 'interrupted')
      assert.ok(recovered.data.includes('token:kept'), recovered.data)
      assert.deepEqual(await cli('tab', 'list', '--workspace', String(workspaceId)), layout)
      const revived = await client.request<TerminalSnapshot>('terminal.attach', target)
      assert.notEqual(revived.sessionId, generation)
      assert.equal(revived.status, 'running')
      assert.ok(revived.data.includes('New shell session'))
      await cli('pane', 'close', '--workspace', String(workspaceId), '--pane', String(added.id))
      await cli('project', 'remove', String(project.id))
    } catch (error) {
      console.error(
        await readFile(join(home, 'mux/server.log'), 'utf8').catch(() => 'No mux error log')
      )
      throw error
    } finally {
      if (client) {
        await client.request('server.stop').catch(() => {})
        client.close()
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (previous === undefined) delete process.env.CEREBRO_HOME
      else process.env.CEREBRO_HOME = previous
      if (previousShell === undefined) delete process.env.SHELL
      else process.env.SHELL = previousShell
      await rm(home, { recursive: true, force: true })
    }
  }
)

test(
  'CLI creates a linked worktree without Electron, operation retries deduplicate, and subrepo scope is validated',
  { timeout: 60000, skip: process.platform === 'win32' },
  async () => {
    const home = await mkdtemp(join(tmpdir(), 'cerebro-mux-workspace-'))
    const previous = {
      home: process.env.CEREBRO_HOME,
      db: process.env.CEREBRO_DB_PATH,
      shell: process.env.SHELL
    }
    process.env.CEREBRO_HOME = home
    delete process.env.CEREBRO_DB_PATH
    process.env.SHELL = '/bin/sh'
    const root = join(home, 'source')
    await mkdir(root)
    const git = async (...args: string[]): Promise<void> => {
      await exec('git', args, { cwd: root })
    }
    let client: MuxClient | undefined
    try {
      await git('init', '-b', 'main')
      await git('config', 'user.email', 'mux@local')
      await git('config', 'user.name', 'Mux Test')
      await writeFile(join(root, 'README.md'), 'local fixture\n')
      await git('add', '.')
      await git('commit', '-m', 'initial')
      const remote = 'https://github.com/cerebro-fixture/project.git'
      await git('remote', 'add', 'origin', remote)
      client = await connectMux({ runtimeDir })
      const project = await client.request<Project>('registry', {
        action: 'project.createDirectory',
        directory: root
      })
      await git('config', `url.file://${root}.insteadOf`, remote)
      const cli = async <T>(...args: string[]): Promise<T> =>
        JSON.parse((await exec(process.execPath, [cliEntry, ...args], { env: process.env })).stdout)
      const workspace = await cli<Workspace>(
        'workspace',
        'create',
        '--project',
        String(project.id),
        '--branch',
        'feature',
        '--from',
        'main'
      )
      assert.equal(workspace.kind, 'worktree')
      assert.equal(workspace.branch, 'feature')
      assert.equal(
        await readFile(join(workspace.localPath, 'README.md'), 'utf8'),
        'local fixture\n'
      )
      const request = {
        target: 'tab',
        action: 'create',
        workspaceId: workspace.id,
        kind: 'terminal'
      }
      const operation = 'same-tab-operation'
      const first = await client.request<{ result: WorkspaceTab }>(
        'layout.command',
        request,
        120000,
        operation
      )
      const second = await client.request<typeof first>(
        'layout.command',
        request,
        120000,
        operation
      )
      assert.deepEqual(second, first)
      const target = { workspaceId: workspace.id, paneId: first.result.root.id }
      const captured = await client.request<TerminalSnapshot>('terminal.capture', target)
      assert.equal(captured.repositoryId, workspace.repositoryId)
      await assert.rejects(
        client.request('layout.command', { ...request, repositoryId: 999999 }),
        /Repository does not belong/
      )
      await client.request('terminal.write', {
        ...target,
        data: 'printf \'\\n%s\\n\' "ids:$CEREBRO_PROJECT_ID:$CEREBRO_WORKSPACE_ID:$CEREBRO_REPOSITORY_ID:$CEREBRO_PANE_ID"\r'
      })
      await until(
        () => client!.request<TerminalSnapshot>('terminal.capture', target),
        (value) =>
          value.data.includes(
            `ids:${project.id}:${workspace.id}:${workspace.repositoryId}:${target.paneId}`
          )
      )
      const gitRequest = new Promise<{ id: string; args: string[]; cwd?: string }>((resolve) =>
        client!.once('git', resolve)
      )
      const creating = client.request<Workspace>('registry', {
        action: 'workspace.create',
        projectId: project.id,
        branch: 'io-during-git',
        from: 'main',
        provider: true
      })
      const callback = await gitRequest
      const duringGit = await client
        .request<TerminalSnapshot>('terminal.capture', target, 1500)
        .catch((error) => error as Error)
      const layoutDuringGit = await client
        .request(
          'layout.command',
          { target: 'tab', action: 'create', workspaceId: workspace.id, kind: 'changes' },
          1500
        )
        .catch((error) => error as Error)
      const gitResult = await exec('git', callback.args, { cwd: callback.cwd })
      await client.request('git.reply', { id: callback.id, result: gitResult.stdout })
      await creating
      if (duringGit instanceof Error) throw duringGit
      if (layoutDuringGit instanceof Error) throw layoutDuringGit
      assert.equal(duringGit.status, 'running')
      const create = {
        action: 'workspace.create',
        projectId: project.id,
        branch: 'recover-operation',
        from: 'main'
      }
      const operationId = 'recover-workspace-operation'
      const created = await client.request<Workspace>('registry', create, 120000, operationId)
      const stopped = new Promise<void>((resolve) => client!.once('disconnected', resolve))
      await client.request('server.stop')
      await stopped
      client.close()
      // Simulate a committed workspace whose response was not recorded before a crash.
      const database = new DatabaseSync(join(home, 'cerebro.sqlite'))
      database.prepare('UPDATE mux_operations SET result=NULL WHERE id=?').run(operationId)
      database.close()
      client = await connectMux({ runtimeDir })
      const reconciled = await client.request<Workspace>('registry', create, 120000, operationId)
      assert.equal(reconciled.id, created.id)
      await cli('workspace', 'remove', String(workspace.id))
      assert.equal(
        await readFile(join(workspace.localPath, 'README.md'), 'utf8'),
        'local fixture\n'
      )
    } finally {
      if (client) {
        await client.request('server.stop').catch(() => {})
        client.close()
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
      await rm(home, { recursive: true, force: true })
      for (const [key, value] of Object.entries({
        CEREBRO_HOME: previous.home,
        CEREBRO_DB_PATH: previous.db,
        SHELL: previous.shell
      })) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }
)
