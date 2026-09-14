import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
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
test('a usage delta from the adapter is reflected on the session', async () => {
  const f = fixture(async (context) => {
    context.emit({
      type: 'usage',
      usage: { usedTokens: 12345, contextWindow: 200000, percentage: 6 }
    })
  })
  try {
    const service = new AgentSessions(f.dir, () => {}, f.drivers)
    const state = await service.command(scope, send)
    assert.deepEqual(state.session?.contextUsage, {
      usedTokens: 12345,
      contextWindow: 200000,
      percentage: 6
    })
    await service.shutdown()
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

test('an evicted item is removed from the persisted transcript, not just hidden from new events', async () => {
  const f = fixture(async (context) => {
    context.emit({
      type: 'item',
      item: { id: 'refused', kind: 'text', text: 'REFUSED DRAFT', status: 'completed' }
    })
    context.emit({
      type: 'item',
      item: { id: 'final', kind: 'text', text: 'FINAL ANSWER', status: 'completed' }
    })
    context.emit({ type: 'evict', ids: ['refused'] })
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const view = await service.command(scope, send)
    const texts = view.session!.items.filter((i) => i.kind === 'text').map((i) => i.text)
    assert.deepEqual(texts, ['FINAL ANSWER'])
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
test('an image attachment stays readable from both the source session and a fork of it', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const f = fixture(async () => {})
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const upload = {
      id: 'img-fork',
      kind: 'image' as const,
      name: 'shot.png',
      mimeType: 'image/png' as const,
      bytes: 70,
      width: 1,
      height: 1,
      data: png
    }
    const first = await service.command(scope, { ...send, attachments: [upload] })
    const sourceId = first.session!.id
    const turnId = first.session!.turnId!
    const forked = await service.command(scope, {
      ...send,
      action: 'fork',
      sessionId: sourceId,
      turnId
    })
    const forkedId = forked.session!.id
    assert.equal(service.attachment(1, sourceId, 'img-fork').data, png)
    assert.equal(service.attachment(1, forkedId, 'img-fork').data, png)
    // Only one copy on disk — the fork never had to touch the file.
    assert.equal(
      readdirSync(join(f.dir, 'attachments')).filter((name) => name.startsWith('img-fork')).length,
      1
    )
  } finally {
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('a legacy per-session attachment layout is migrated into the flat store on startup', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const f = fixture(async () => {})
  const legacyDir = join(f.dir, 'attachments', 'old-session-id')
  mkdirSync(legacyDir, { recursive: true })
  writeFileSync(join(legacyDir, 'img-legacy.png'), Buffer.from(png, 'base64'))
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    assert.equal(readFileSync(join(f.dir, 'attachments', 'img-legacy.png')).toString('base64'), png)
    assert(!existsSync(legacyDir))
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
    const stored = join(f.dir, 'attachments', 'img-1.png')
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
test('sending while busy enqueues instead of throwing, and leaves the running turn untouched', async () => {
  const f = fixture(async (context) => {
    await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve()))
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const first = await service.command(scope, send)
    const view = await service.command(scope, {
      ...send,
      commandId: 'second',
      text: 'second message'
    })
    assert.equal(view.session?.status, 'running')
    assert.equal(view.session?.turnId, first.session?.turnId)
    assert.equal(view.session?.items.length, 1)
    assert.equal(view.session?.queue?.length, 1)
    assert.equal(view.session?.queue?.[0].id, 'second')
    assert.equal(view.session?.queue?.[0].text, 'second message')
    assert(view.session?.commands.includes('second'))
    // A retry with the same commandId is deduped, not queued twice.
    const repeat = await service.command(scope, {
      ...send,
      commandId: 'second',
      text: 'second message'
    })
    assert.equal(repeat.session?.queue?.length, 1)
  } finally {
    await service.command(scope, { ...send, action: 'stop' })
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('steer folds a queued message into the running turn and removes it from the queue', async () => {
  const steered: Array<{ text: string }> = []
  const f = fixture(async (context) => {
    context.registerSteer?.(async (text) => {
      steered.push({ text })
    })
    await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve()))
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const first = await service.command(scope, send)
    await service.command(scope, { ...send, commandId: 'second', text: 'steer me' })
    const view = await service.command(scope, {
      ...send,
      action: 'steer',
      sessionId: first.session!.id,
      commandId: 'second'
    })
    assert.deepEqual(steered, [{ text: 'steer me' }])
    assert.equal(view.session?.queue?.length, 0)
    assert.equal(view.session?.items.length, 2)
    const steeredItem = view.session!.items[1]
    assert.equal(steeredItem.kind, 'user')
    assert.equal(steeredItem.text, 'steer me')
    assert.equal(steeredItem.turnId, first.session?.turnId)
    // Steering an already-steered/removed id is a no-op, not an error.
    const again = await service.command(scope, {
      ...send,
      action: 'steer',
      sessionId: first.session!.id,
      commandId: 'second'
    })
    assert.equal(again.session?.items.length, 2)
  } finally {
    await service.command(scope, { ...send, action: 'stop' })
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('steer rejects a queued message whose model or access mode differs from the running turn', async () => {
  const f = fixture(async (context) => {
    context.registerSteer?.(async () => {})
    await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve()))
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const first = await service.command(scope, send)
    await service.command(scope, {
      ...send,
      commandId: 'second',
      text: 'different mode',
      accessMode: 'read'
    })
    await assert.rejects(
      service.command(scope, {
        ...send,
        action: 'steer',
        sessionId: first.session!.id,
        commandId: 'second'
      }),
      /different model or access/
    )
    const view = await service.command(scope, { ...send, action: 'get' })
    assert.equal(view.session?.queue?.length, 1)
  } finally {
    await service.command(scope, { ...send, action: 'stop' })
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('dequeue removes a queued message without touching the running turn, and cleans up its attachment file', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const f = fixture(async (context) => {
    await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve()))
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const first = await service.command(scope, send)
    const upload = {
      id: 'img-q',
      kind: 'image' as const,
      name: 'shot.png',
      mimeType: 'image/png' as const,
      bytes: 70,
      width: 1,
      height: 1,
      data: png
    }
    await service.command(scope, {
      ...send,
      commandId: 'second',
      text: 'with image',
      attachments: [upload]
    })
    const stored = join(f.dir, 'attachments', 'img-q.png')
    assert.equal(readFileSync(stored).toString('base64'), png)
    const view = await service.command(scope, {
      ...send,
      action: 'dequeue',
      sessionId: first.session!.id,
      commandId: 'second'
    })
    assert.equal(view.session?.queue?.length, 0)
    assert.equal(view.session?.status, 'running')
    assert.equal(view.session?.items.length, 1)
    assert.throws(() => readFileSync(stored))
    // Removing an already-gone id is a no-op.
    const again = await service.command(scope, {
      ...send,
      action: 'dequeue',
      sessionId: first.session!.id,
      commandId: 'second'
    })
    assert.equal(again.session?.queue?.length, 0)
  } finally {
    await service.command(scope, { ...send, action: 'stop' })
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('a queued message auto-fires as the next turn once the running turn finishes', async () => {
  let started = 0
  const releases: Array<() => void> = []
  const startedResolvers: Array<() => void> = []
  const startedPromises: Promise<void>[] = []
  for (let i = 0; i < 2; i++) {
    let resolve: () => void = () => {}
    startedPromises.push(new Promise((r) => (resolve = r)))
    startedResolvers.push(resolve)
  }
  const runs: string[] = []
  const f = fixture(async (context) => {
    const index = started++
    runs.push(context.text)
    startedResolvers[index]()
    await new Promise<void>((resolve) => releases.push(resolve))
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    const first = await service.command(scope, send)
    await startedPromises[0]
    await service.command(scope, { ...send, commandId: 'second', text: 'follow-up' })
    releases[0]()
    await startedPromises[1]
    assert.deepEqual(runs, ['hello', 'follow-up'])
    const view = await service.command(scope, { ...send, action: 'get' })
    assert.equal(view.session?.status, 'running')
    assert.notEqual(view.session?.turnId, first.session?.turnId)
    assert.equal(view.session?.queue?.length, 0)
    assert.equal(view.session?.items.length, 2)
    assert.equal(view.session?.items[1].text, 'follow-up')
  } finally {
    releases.forEach((release) => release())
    await service.command(scope, { ...send, action: 'stop' })
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
test('stopWorkspace converges through an auto-flushed queue instead of leaving an orphaned run', async () => {
  const seen: string[] = []
  const f = fixture(async (context) => {
    seen.push(context.text)
    await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve()))
  })
  const service = new AgentSessions(f.dir, () => {}, f.drivers)
  try {
    await service.command(scope, send)
    await service.command(scope, { ...send, commandId: 'second', text: 'second' })
    const queued = await service.command(scope, { ...send, action: 'get' })
    assert.equal(queued.session?.queue?.length, 1)
    await service.stopWorkspace(scope.workspaceId)
    const after = await service.command(scope, { ...send, action: 'get' })
    assert.equal(after.session?.status, 'interrupted')
    assert.deepEqual(seen, ['hello', 'second'])
    assert.equal(after.session?.queue?.length, 0)
  } finally {
    await service.shutdown()
    rmSync(f.dir, { recursive: true, force: true })
  }
})
