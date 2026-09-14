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

test('fork copies a completed section into a new session, leaves the source untouched, and the fork is durable', async () => {
  const f = fixture(async (context) => {
    context.emit({
      type: 'item',
      item: { id: 'answer', kind: 'text', text: `reply to ${context.text}` }
    })
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const first = await service.command(scope, send)
    const sourceId = first.session!.id
    const firstTurnId = first.session!.items[0].turnId
    await service.command(scope, { ...send, commandId: 'second', text: 'again' })
    const beforeFork = await service.command(scope, { ...send, action: 'get' })
    assert.equal(beforeFork.session!.items.length, 4)

    await assert.rejects(
      service.command(scope, {
        ...send,
        action: 'fork',
        sessionId: sourceId,
        turnId: 'missing'
      }),
      /section is no longer part/
    )
    await assert.rejects(
      service.command(scope, {
        ...send,
        action: 'fork',
        sessionId: 'missing',
        turnId: firstTurnId
      }),
      /not found in this repository/
    )

    const forked = await service.command(scope, {
      ...send,
      action: 'fork',
      sessionId: sourceId,
      turnId: firstTurnId
    })
    assert.notEqual(forked.session!.id, sourceId)
    assert.equal(forked.session!.items.length, 2)
    assert.deepEqual(forked.session!.forkedFrom, { sessionId: sourceId, turnId: firstTurnId })
    assert.equal(forked.session!.nativeId, undefined)
    assert.equal(forked.session!.commands.length, 0)
    assert.equal(forked.session!.title, `${first.session!.title} (fork)`)

    const source = await service.command(scope, { ...send, action: 'open', sessionId: sourceId })
    assert.equal(source.session!.items.length, 4)

    await service.shutdown()
    const restored = new AgentSessions(f.dir, () => {}, f.drivers)
    const reopened = await restored.command(scope, {
      ...send,
      action: 'open',
      sessionId: forked.session!.id
    })
    assert.equal(reopened.session!.items.length, 2)
    await restored.shutdown()
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('fork rejects while the source turn is still running', async () => {
  const f = fixture(async (context) => {
    await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve()))
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const first = await service.command(scope, send)
    await assert.rejects(
      service.command(scope, {
        ...send,
        action: 'fork',
        sessionId: first.session!.id,
        turnId: first.session!.turnId!
      }),
      /Stop the running turn/
    )
  } finally {
    await service.command(scope, { ...send, action: 'stop' })
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('a Claude session with no recorded checkpoint forks without attempting a native fork', async () => {
  const claudeModel: AgentModel = { ...model, harness: 'claude' }
  const f = fixture(async (context) => {
    context.emit({ type: 'binding', nativeId: 'native-claude' })
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const first = await service.command(scope, { ...send, model: claudeModel })
    const forked = await service.command(scope, {
      ...send,
      action: 'fork',
      sessionId: first.session!.id,
      turnId: first.session!.turnId!
    })
    assert.equal(forked.session!.nativeId, undefined)
    assert.equal(forked.session!.items.length, 1)
  } finally {
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('image attachments are validated, stored outside the snapshot, passed to the adapter, and readable per workspace', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const received: RunContext['attachments'][] = []
  const f = fixture(async (context) => {
    received.push(context.attachments)
  })
  const upload = {
    id: 'img-1',
    kind: 'image' as const,
    name: 'shot.png',
    mimeType: 'image/png' as const,
    bytes: 70,
    width: 1,
    height: 1,
    data: png
  }
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    await assert.rejects(
      service.command(scope, { ...send, attachments: [{ ...upload, data: 'aGVsbG8=' }] }),
      /not a valid image\/png/
    )
    await assert.rejects(
      service.command(scope, {
        ...send,
        attachments: [{ ...upload, mimeType: 'text/plain' as 'image/png' }]
      }),
      /Invalid image attachment/
    )
    const textOnly: AgentAdapter = {
      models: async () => [{ ...model, modalities: ['text'] }],
      run: async () => {}
    }
    const textOnlyDir = mkdtempSync(join(tmpdir(), 'cerebro-agents-text-'))
    const textOnlyService = new AgentSessions(textOnlyDir, () => {}, {
      claude: textOnly,
      codex: textOnly,
      pi: textOnly
    })
    try {
      await assert.rejects(
        textOnlyService.command(scope, { ...send, attachments: [upload] }),
        /does not accept images/
      )
    } finally {
      await textOnlyService.shutdown()
      rmSync(textOnlyDir, { recursive: true, force: true })
    }
    const view = await service.command(scope, {
      ...send,
      text: 'attachments [Image #1]',
      attachments: [upload]
    })
    const session = view.session!
    const user = session.items.find((item) => item.kind === 'user')!
    assert.deepEqual(user.attachments, [
      {
        id: 'img-1',
        kind: 'image',
        name: 'shot.png',
        mimeType: 'image/png',
        bytes: 70,
        width: 1,
        height: 1
      }
    ])
    assert(!JSON.stringify(session).includes(png))
    const stored = join(f.dir, 'attachments', session.id, 'img-1.png')
    assert.equal(readFileSync(stored).toString('base64'), png)
    assert.deepEqual(received, [[{ ...user.attachments![0], path: stored }]])
    assert.deepEqual(service.attachment(1, session.id, 'img-1'), {
      mimeType: 'image/png',
      data: png
    })
    assert.throws(() => service.attachment(2, session.id, 'img-1'), /not found in this workspace/)
    assert.throws(() => service.attachment(1, session.id, 'missing'), /Image not found/)
    await service.shutdown()
    const restored = new AgentSessions(f.dir, () => {}, f.drivers)
    assert.equal(restored.attachment(1, session.id, 'img-1').data, png)
    await restored.shutdown()
  } finally {
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
