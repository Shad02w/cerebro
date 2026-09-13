import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentSessions } from './service'
import type { AgentModel, AgentSession } from '@cerebro/core'
import type { AgentAdapter, RunContext } from './adapters'
const model: AgentModel = {
  key: 'test',
  instance: 'local',
  harness: 'codex',
  provider: 'test',
  id: 'test',
  label: 'Test',
  source: 'native',
  available: true,
  reasoning: []
}
const scope = { workspaceId: 1, paneId: 1, repositoryId: 3, cwd: '/tmp' }
const send = {
  action: 'send' as const,
  workspaceId: 1,
  paneId: 1,
  commandId: 'first',
  text: 'hello',
  model
}
function fixture(run: (context: RunContext) => Promise<void>): {
  dir: string
  drivers: Record<'claude' | 'codex' | 'pi', AgentAdapter>
} {
  const dir = mkdtempSync(join(tmpdir(), 'cerebro-agents-'))
  const adapter: AgentAdapter = { models: async () => [model], run }
  return { dir, drivers: { claude: adapter, codex: adapter, pi: adapter } }
}
test('accepted command is durable before dispatch; duplicate sends do not replay; native binding and final replacement survive restart', async () => {
  let calls = 0
  const f = fixture(async (context) => {
    calls++
    const stored: AgentSession = JSON.parse(
      readFileSync(join(f.dir, `session-${context.session.id}.json`), 'utf8')
    )
    assert(stored.commands.includes('first'))
    context.emit({ type: 'binding', nativeId: 'native-one' })
    context.emit({ type: 'item', item: { id: 'answer', kind: 'text', text: 'hel' }, append: true })
    context.emit({ type: 'item', item: { id: 'answer', kind: 'text', text: 'hello' } })
  })
  try {
    const service = new AgentSessions(f.dir, () => {}, f.drivers)
    await service.command(scope, send)
    await service.command(scope, send)
    await service.shutdown()
    const restored = new AgentSessions(f.dir, () => {}, f.drivers)
    const state = await restored.command(scope, { ...send, action: 'get' })
    assert.equal(calls, 1)
    assert.equal(state.session?.nativeId, 'native-one')
    assert.deepEqual(
      state.session?.items.filter((i) => i.kind === 'text').map((i) => i.text),
      ['hello']
    )
    await restored.command(scope, send)
    assert.equal(calls, 1)
    await restored.shutdown()
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('closing a view retains the run; reopen, scope isolation, pending reply correlation and cancellation', async () => {
  const f = fixture(async (context) => {
    const answer = await context.ask({
      id: 'permission',
      title: 'Bash',
      text: 'pwd',
      kind: 'approval'
    })
    assert.equal(answer.allow, false)
  })
  try {
    const service = new AgentSessions(f.dir, () => {}, f.drivers)
    const first = await service.command(scope, send)
    assert.equal(first.session?.status, 'waiting')
    const id = first.session!.id
    assert.equal((await service.command(scope, { ...send, action: 'new' })).session, null)
    await assert.rejects(
      service.command({ ...scope, repositoryId: 4 }, { ...send, action: 'open', sessionId: id }),
      /repository/
    )
    await service.command(scope, { ...send, action: 'open', sessionId: id })
    await assert.rejects(
      service.command(scope, { ...send, action: 'reply', requestId: 'stale' }),
      /no longer pending/
    )
    await service.command(scope, { ...send, action: 'stop' })
    await service.shutdown()
    const restored = new AgentSessions(f.dir, () => {}, f.drivers)
    const state = await restored.command(scope, { ...send, action: 'get' })
    assert.equal(state.session?.status, 'interrupted')
    assert(state.session?.items.find((i) => i.request)?.request?.resolved)
    await restored.shutdown()
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('crash recovery marks uncertain turn interrupted and retains favorites without starting agents', async () => {
  let calls = 0
  const f = fixture(async () => {
    calls++
  })
  try {
    const session: AgentSession = {
      version: 1,
      id: 'saved',
      workspaceId: 1,
      repositoryId: 3,
      cwd: '/tmp',
      title: 'Saved',
      model,
      status: 'running',
      generation: 'old',
      sequence: 4,
      updatedAt: 0,
      items: [],
      commands: ['uncertain']
    }
    writeFileSync(join(f.dir, 'session-saved.json'), JSON.stringify(session))
    writeFileSync(join(f.dir, 'bindings.json'), JSON.stringify({ 1: 'saved' }))
    const service = new AgentSessions(f.dir, () => {}, f.drivers)
    assert.equal(
      (await service.command(scope, { ...send, action: 'get' })).session?.status,
      'interrupted'
    )
    await service.command(scope, { ...send, commandId: 'uncertain' })
    assert.equal(calls, 0)
    await service.favorite(model.key, true)
    await service.shutdown()
    const restored = new AgentSessions(f.dir, () => {}, f.drivers)
    assert.equal((await restored.models()).favorites[0].key, model.key)
    await restored.shutdown()
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test('access defaults to full, persists across restart, changes between turns, and rejects invalid input', async () => {
  const modes: Array<string | undefined> = []
  const f = fixture(async ({ session }) => {
    modes.push(session.accessMode)
  })
  let service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    await service.command(scope, send)
    await service.shutdown()
    service = new AgentSessions(f.dir, () => {}, f.drivers)
    assert.equal(
      (await service.command(scope, { ...send, action: 'get' })).session?.accessMode,
      'full'
    )
    await service.command(scope, { ...send, commandId: 'read', accessMode: 'read' })
    await service.shutdown()
    service = new AgentSessions(f.dir, () => {}, f.drivers)
    await service.command(scope, { ...send, commandId: 'retain' })
    await service.shutdown()
    service = new AgentSessions(f.dir, () => {}, f.drivers)
    await assert.rejects(
      service.command(scope, { ...send, commandId: 'invalid', accessMode: 'invalid' as 'full' }),
      /Unsupported access mode/
    )
    assert.deepEqual(modes, ['full', 'read', 'read'])
  } finally {
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
