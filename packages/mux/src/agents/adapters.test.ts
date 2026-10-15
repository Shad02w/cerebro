import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  adapters,
  claudeModelLabel,
  runTurn,
  type BackgroundTaskUpdate,
  type RunAttachment,
  type SubagentUpdate
} from './adapters'
import type { AgentDelta, AgentHarness, AgentSession } from '@cerebro/core'
const fixture = resolve(__dirname, 'fixtures/fake-harness.cjs')
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
test('claudeModelLabel keeps model names across Claude Code catalog shapes', () => {
  // Older/current shape: description tip is the versioned name.
  assert.equal(
    claudeModelLabel({
      displayName: 'Sonnet',
      description: 'Sonnet 5.5 · Efficient for routine tasks · $2/$10 per Mtok',
      resolvedModel: 'claude-sonnet-5-5'
    }),
    'Sonnet 5.5'
  )
  assert.equal(
    claudeModelLabel({
      displayName: 'Haiku',
      description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok',
      resolvedModel: 'claude-haiku-4-5-20251001'
    }),
    'Haiku 4.5'
  )
  // Newer shape: description tip is a capability blurb — recover name + version.
  assert.equal(
    claudeModelLabel({
      value: 'claude-opus-5',
      displayName: 'Opus',
      description: 'Best for everyday, complex tasks · $4/$20 per Mtok',
      resolvedModel: 'claude-opus-5'
    }),
    'Opus 5'
  )
  assert.equal(
    claudeModelLabel({
      value: 'claude-opus-4-8',
      displayName: 'Opus',
      description: 'Best for everyday, complex tasks · $15/$75 per Mtok',
      resolvedModel: 'claude-opus-4-8'
    }),
    'Opus 4.8'
  )
  assert.equal(
    claudeModelLabel({
      value: 'claude-sonnet-5',
      displayName: 'Sonnet',
      description: 'Efficient for routine tasks · $2/$10 per Mtok',
      resolvedModel: 'claude-sonnet-5'
    }),
    'Sonnet 5'
  )
  assert.equal(
    claudeModelLabel({
      value: 'claude-fable-5',
      displayName: 'Fable 5',
      description: 'Most capable for your hardest and longest-running tasks · $10/$50 per Mtok',
      resolvedModel: 'claude-fable-5'
    }),
    'Fable 5'
  )
  assert.equal(
    claudeModelLabel({
      displayName: 'Default (recommended)',
      description: 'Use the default model (currently Opus 5.5) · $4/$20 per Mtok',
      resolvedModel: 'claude-opus-5-5'
    }),
    'Default (recommended) · claude-opus-5-5'
  )
  assert.equal(claudeModelLabel({ displayName: 'Fable' }), 'Fable')
})
for (const harness of ['claude', 'codex', 'pi'] as AgentHarness[]) {
  test(
    `${harness}: native model discovery, streamed response, resume binding and teardown`,
    { timeout: 15_000 },
    async () => {
      process.env[`CEREBRO_${harness.toUpperCase()}_PATH`] = fixture
      const models = await adapters[harness].models('/tmp')
      assert.equal(models[0].label, 'Test Model')
      if (harness === 'claude') {
        assert.deepEqual(models[0].reasoning, ['low', 'medium', 'high'])
        assert.equal(models[1].label, 'Test Sonnet 5')
        assert.equal(models[1].id, 'sonnet')
        assert.deepEqual(models[1].reasoning, ['low', 'medium', 'high', 'xhigh', 'max'])
      }
      const events: AgentDelta[] = []
      const session: AgentSession = {
        version: 1,
        id: 'logical',
        workspaceId: 1,
        repositoryId: null,
        cwd: '/tmp',
        title: 'Test',
        model: models[0],
        status: 'running',
        generation: 'generation',
        sequence: 0,
        updatedAt: 0,
        items: [],
        commands: []
      }
      await runTurn(adapters[harness], {
        session,
        text: 'hello',
        signal: new AbortController().signal,
        emit: (e) => events.push(e),
        ask: async () => ({ allow: false, answers: {} })
      })
      assert(events.some((e) => e.type === 'binding' && e.nativeId))
      assert(events.some((e) => e.type === 'item' && e.item.text.includes('Adapter connected.')))
      assert(events.some((e) => e.type === 'item' && e.append === true))
      const usage = events.find((e) => e.type === 'usage')
      assert(usage && usage.type === 'usage')
      assert(usage.usage.contextWindow > 0)
      assert(usage.usage.usedTokens > 0)
      assert(usage.usage.percentage >= 0 && usage.usage.percentage <= 100)
      if (harness === 'codex')
        assert.deepEqual(usage.usage, {
          usedTokens: 43759,
          contextWindow: 258400,
          percentage: 17
        })
      const checkpoint = events.find((e) => e.type === 'checkpoint')
      if (harness === 'claude')
        assert.deepEqual(checkpoint, {
          type: 'checkpoint',
          turnId: undefined,
          chainId: 'chain-test'
        })
      else assert.equal(checkpoint, undefined)
      if (harness === 'codex') {
        const todo = events.find((event) => event.type === 'todo')
        assert(todo?.type === 'todo')
        assert.deepEqual(todo.todo, {
          kind: 'todo',
          listId: 'session:logical:todo',
          explanation: 'Connecting the adapters next.',
          items: [
            { id: '0', label: 'Inspect the workspace', status: 'completed' },
            { id: '1', label: 'Connect the adapters', status: 'in_progress' }
          ]
        })
      } else
        assert.equal(
          events.some((event) => event.type === 'todo'),
          false
        )
    }
  )
}
test(
  'Codex context usage uses the latest call and skips events that omit it or the window',
  { timeout: 15_000 },
  async () => {
    process.env.CEREBRO_CODEX_PATH = fixture
    const model = (await adapters.codex.models('/tmp'))[0]
    const session: AgentSession = {
      version: 1,
      id: 'logical',
      workspaceId: 1,
      repositoryId: null,
      cwd: '/tmp',
      title: 'Test',
      model,
      status: 'running',
      generation: 'generation',
      sequence: 0,
      updatedAt: 0,
      items: [],
      commands: []
    }
    for (const text of ['usage-without-last', 'usage-without-window']) {
      const events: AgentDelta[] = []
      await runTurn(adapters.codex, {
        session,
        text,
        signal: new AbortController().signal,
        emit: (event) => events.push(event),
        ask: async () => ({ allow: false, answers: {} })
      })
      assert.equal(
        events.some((event) => event.type === 'usage'),
        false
      )
    }
  }
)
test(
  'Codex: request correlation, approval decision, interrupt, and native resume',
  { timeout: 15_000 },
  async () => {
    const model = (await adapters.codex.models('/tmp'))[0]
    const session = {
      version: 1,
      id: 'logical',
      workspaceId: 1,
      repositoryId: null,
      cwd: '/tmp',
      title: 'Test',
      model,
      status: 'running',
      generation: 'g',
      sequence: 0,
      updatedAt: 0,
      items: [],
      commands: [],
      nativeId: 'thread-test',
      accessMode: 'edit'
    } as AgentSession
    let asked = false
    await runTurn(adapters.codex, {
      session,
      text: 'approval',
      signal: new AbortController().signal,
      emit: () => {},
      ask: async (request) => {
        asked = true
        assert.equal(request.id, 'approval-test')
        return { allow: false, answers: {} }
      }
    })
    assert(asked)
    const controller = new AbortController()
    const running = runTurn(adapters.codex, {
      session,
      text: 'slow',
      signal: controller.signal,
      emit: (e) => {
        if (e.type === 'item') controller.abort()
      },
      ask: async () => ({ allow: false, answers: {} })
    })
    await assert.rejects(running, /interrupted/)
  }
)

for (const harness of ['claude', 'codex', 'pi'] as AgentHarness[]) {
  test(
    `${harness}: registerSteer folds a message into the running turn`,
    { timeout: 15_000 },
    async () => {
      process.env[`CEREBRO_${harness.toUpperCase()}_PATH`] = fixture
      const model = (await adapters[harness].models('/tmp'))[0]
      const session: AgentSession = {
        version: 1,
        id: 'steer',
        workspaceId: 1,
        repositoryId: null,
        cwd: '/tmp',
        title: 'Steer',
        model,
        status: 'running',
        generation: 'g',
        sequence: 0,
        updatedAt: 0,
        items: [],
        commands: []
      }
      const controller = new AbortController()
      const events: AgentDelta[] = []
      let steer: ((text: string, attachments: RunAttachment[]) => Promise<void>) | undefined
      const running = runTurn(adapters[harness], {
        session,
        text: 'slow',
        signal: controller.signal,
        emit: (e) => events.push(e),
        ask: async () => ({ allow: false, answers: {} }),
        registerSteer: (fn) => {
          steer = fn
        }
      })
      await waitFor(() => steer !== undefined)
      await steer!('steer me', [])
      await waitFor(() => events.some((e) => e.type === 'item' && e.item.text.includes('steer me')))
      controller.abort()
      // Codex/Pi construct a "Turn interrupted." error explicitly; Claude surfaces whatever the
      // SDK throws when its own AbortController fires. The service layer classifies both as
      // 'interrupted' from signal.aborted, not by matching this message — only assert it rejects.
      await assert.rejects(running)
    }
  )
}

test(
  'Claude SDK permission callbacks round-trip through native control messages',
  { timeout: 15000 },
  async () => {
    const model = (await adapters.claude.models('/tmp'))[0]
    let asked = false
    await runTurn(adapters.claude, {
      session: {
        version: 1,
        id: 'logical',
        workspaceId: 1,
        repositoryId: null,
        cwd: '/tmp',
        title: 'Approval',
        accessMode: 'edit',
        model,
        status: 'running',
        generation: 'g',
        sequence: 0,
        updatedAt: 0,
        items: [],
        commands: []
      },
      text: 'approval',
      signal: new AbortController().signal,
      emit: () => {},
      ask: async (request) => {
        asked = true
        assert.equal(request.title, 'Bash')
        assert.equal(request.id, 'tool-test')
        return { allow: false, answers: {} }
      }
    })
    assert(asked)
  }
)

test(
  'Claude reuses streamed item ids for single-block assistant frames instead of duplicating text',
  { timeout: 15_000 },
  async () => {
    process.env.CEREBRO_CLAUDE_PATH = fixture
    const model = (await adapters.claude.models('/tmp'))[0]
    const events: AgentDelta[] = []
    await runTurn(adapters.claude, {
      session: {
        version: 1,
        id: 'logical',
        workspaceId: 1,
        repositoryId: null,
        cwd: '/tmp',
        title: 'Test',
        model,
        status: 'running',
        generation: 'g',
        sequence: 0,
        updatedAt: 0,
        items: [],
        commands: []
      },
      text: 'thinking-then-text',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      ask: async () => ({ allow: false, answers: {} })
    })
    const ids = new Map<string, string>()
    for (const e of events) if (e.type === 'item') ids.set(e.item.id, e.item.kind)
    assert.deepEqual(
      [...ids],
      [
        ['message-think:0', 'reasoning'],
        ['message-think:1', 'text']
      ]
    )
  }
)

test(
  'Claude keeps later blocks on their streamed ids when an earlier block has no completed frame',
  { timeout: 15_000 },
  async () => {
    process.env.CEREBRO_CLAUDE_PATH = fixture
    const model = (await adapters.claude.models('/tmp'))[0]
    const events: AgentDelta[] = []
    await runTurn(adapters.claude, {
      session: {
        version: 1,
        id: 'logical',
        workspaceId: 1,
        repositoryId: null,
        cwd: '/tmp',
        title: 'Test',
        model,
        status: 'running',
        generation: 'g',
        sequence: 0,
        updatedAt: 0,
        items: [],
        commands: []
      },
      text: 'skipped-block',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      ask: async () => ({ allow: false, answers: {} })
    })
    // Fold the deltas the way the service does: same id merges, `append` concatenates text.
    const rows = new Map<string, { kind: string; text: string; status?: string }>()
    for (const e of events) {
      if (e.type !== 'item') continue
      const row = rows.get(e.item.id)
      rows.set(e.item.id, {
        kind: e.item.kind,
        text: e.append ? (row?.text ?? '') + e.item.text : e.item.text,
        status: e.item.status ?? row?.status
      })
    }
    assert.deepEqual(
      [...rows],
      [
        ['message-skip:0', { kind: 'reasoning', text: 'pondering', status: 'completed' }],
        ['message-skip:1', { kind: 'text', text: 'ANSWER', status: 'completed' }]
      ]
    )
  }
)

test(
  'Claude evicts a refused draft superseded by a fallback-model retry',
  { timeout: 15_000 },
  async () => {
    process.env.CEREBRO_CLAUDE_PATH = fixture
    const model = (await adapters.claude.models('/tmp'))[0]
    const events: AgentDelta[] = []
    await runTurn(adapters.claude, {
      session: {
        version: 1,
        id: 'logical',
        workspaceId: 1,
        repositoryId: null,
        cwd: '/tmp',
        title: 'Test',
        model,
        status: 'running',
        generation: 'g',
        sequence: 0,
        updatedAt: 0,
        items: [],
        commands: []
      },
      text: 'refusal-fallback',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      ask: async () => ({ allow: false, answers: {} })
    })
    // The adapter emits the refused draft as it streams in — eviction is the service layer's job,
    // driven by the `evict` event the adapter emits once the fallback names what it superseded.
    assert(
      events.some(
        (e) => e.type === 'item' && e.item.kind === 'text' && e.item.text.includes('REFUSED DRAFT')
      )
    )
    assert(
      events.some(
        (e) => e.type === 'item' && e.item.kind === 'text' && e.item.text === 'FINAL ANSWER'
      )
    )
    const evictions = events.filter((e) => e.type === 'evict').flatMap((e) => e.ids)
    assert(evictions.includes('refused-message:0'))
  }
)

for (const harness of ['claude', 'codex', 'pi'] as const) {
  test(`${harness}: access settings reach native startup and resume`, async () => {
    process.env[`CEREBRO_${harness.toUpperCase()}_PATH`] = fixture
    const model = (await adapters[harness].models('/tmp'))[0]
    for (const accessMode of [undefined, 'full', 'edit', 'read'] as const) {
      for (const nativeId of [undefined, 'saved-session']) {
        const events: AgentDelta[] = []
        await runTurn(adapters[harness], {
          session: {
            version: 1,
            id: 'access',
            workspaceId: 1,
            repositoryId: null,
            cwd: '/tmp',
            title: 'Access',
            model,
            status: 'running',
            generation: 'g',
            sequence: 0,
            updatedAt: 0,
            items: [],
            commands: [],
            accessMode,
            nativeId
          },
          text: 'access-settings',
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
          ask: async () => {
            throw new Error('Unexpected approval request')
          }
        })
        const response = events.find(
          (e) => e.type === 'item' && e.item.kind === 'text' && e.item.text.length > 0
        )
        assert(response?.type === 'item')
        const settings = JSON.parse(response.item.text)
        if (harness === 'codex') {
          assert.equal(settings.approvalPolicy, accessMode === 'edit' ? 'on-request' : 'never')
          assert.equal(
            settings.sandbox,
            accessMode === 'read'
              ? 'read-only'
              : accessMode === 'edit'
                ? 'workspace-write'
                : 'danger-full-access'
          )
        } else if (harness === 'claude') {
          assert.equal(
            settings[settings.indexOf('--permission-mode') + 1],
            accessMode === 'read'
              ? 'plan'
              : accessMode === 'edit'
                ? 'acceptEdits'
                : 'bypassPermissions'
          )
          assert.equal(
            settings.includes('--allow-dangerously-skip-permissions'),
            !accessMode || accessMode === 'full'
          )
        } else if (accessMode === 'read' || accessMode === 'edit') {
          assert(settings.includes('--no-extensions'))
          assert.equal(
            settings[settings.indexOf('--tools') + 1],
            accessMode === 'read' ? 'read,grep,find,ls' : 'read,grep,find,ls,edit,write'
          )
        } else {
          assert(settings.includes('--approve'))
          assert(!settings.includes('--tools'))
        }
      }
    }
  })
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
for (const harness of ['claude', 'codex', 'pi'] as const) {
  test(`${harness}: image attachments reach the native prompt and models report modalities`, async () => {
    process.env[`CEREBRO_${harness.toUpperCase()}_PATH`] = fixture
    const models = await adapters[harness].models('/tmp')
    assert.deepEqual(models[0].modalities, ['text', 'image'])
    if (harness === 'codex') assert.deepEqual(models[1].modalities, ['text'])
    const dir = mkdtempSync(join(tmpdir(), 'cerebro-attachments-'))
    const path = join(dir, 'shot.png')
    writeFileSync(path, png)
    const events: AgentDelta[] = []
    try {
      await runTurn(adapters[harness], {
        session: {
          version: 1,
          id: 'attachments',
          workspaceId: 1,
          repositoryId: null,
          cwd: '/tmp',
          title: 'Attachments',
          model: models[0],
          status: 'running',
          generation: 'g',
          sequence: 0,
          updatedAt: 0,
          items: [],
          commands: []
        },
        text: 'attachments [Image #1] here',
        attachments: [
          { id: 'img-1', kind: 'image', name: 'shot.png', mimeType: 'image/png', bytes: 70, path }
        ],
        signal: new AbortController().signal,
        emit: (event) => events.push(event),
        ask: async () => ({ allow: false, answers: {} })
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const response = events.find(
      (e) =>
        (e.type === 'item' && e.item.kind === 'text' && e.item.text.startsWith('[')) ||
        (e.type === 'item' && e.item.kind === 'text' && e.item.text.startsWith('{'))
    )
    assert(response?.type === 'item')
    const echoed = JSON.parse(response.item.text)
    if (harness === 'codex') {
      assert.equal(echoed[0].type, 'text')
      assert.equal(echoed[0].text, 'attachments [Image #1] here')
      assert.deepEqual(echoed[0].text_elements, [
        { byteRange: { start: 12, end: 22 }, placeholder: '[Image #1]' }
      ])
      assert.deepEqual(echoed[1], { type: 'localImage', path })
    } else if (harness === 'claude') {
      assert.equal(echoed[0].text, 'attachments [Image #1] here')
      assert.deepEqual(echoed[1], {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') }
      })
    } else {
      assert.equal(echoed.message, 'attachments [Image #1] here')
      assert.deepEqual(echoed.images, [
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }
      ])
    }
  })
}

const liveSession = (model: AgentSession['model'], id: string): AgentSession => ({
  version: 1,
  id,
  workspaceId: 1,
  repositoryId: null,
  cwd: '/tmp',
  title: id,
  model,
  status: 'running',
  generation: 'g',
  sequence: 0,
  updatedAt: 0,
  items: [],
  commands: []
})
const idleHost = {
  autonomous: () => undefined,
  task: () => {},
  subagent: () => {},
  idle: () => {},
  exited: () => {}
}
const replies = (events: AgentDelta[]): string[] =>
  events.flatMap((e) => (e.type === 'item' && e.item.kind === 'text' ? [e.item.text] : []))
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

for (const harness of ['claude', 'codex', 'pi'] as AgentHarness[]) {
  test(
    `${harness}: one connection keeps one native process across turns until closed`,
    { timeout: 15_000 },
    async () => {
      process.env[`CEREBRO_${harness.toUpperCase()}_PATH`] = fixture
      const model = (await adapters[harness].models('/tmp'))[0]
      const session = liveSession(model, 'live')
      const connection = adapters[harness].connect(session, idleHost)
      const pids: string[] = []
      for (let turn = 0; turn < 2; turn++) {
        const events: AgentDelta[] = []
        await connection.run({
          session,
          text: 'pid',
          signal: new AbortController().signal,
          emit: (e) => events.push(e),
          ask: async () => ({ allow: false, answers: {} })
        })
        pids.push(replies(events).find((text) => /^\d+$/.test(text))!)
      }
      assert.equal(pids[0], pids[1])
      const pid = Number(pids[0])
      assert(alive(pid))
      connection.close()
      await waitFor(() => !alive(pid))
    }
  )
}

for (const failed of [false, true])
  test(
    `Claude: a background task that ${failed ? 'fails' : 'succeeds'} reports its outcome and wakes a follow-up turn`,
    { timeout: 15_000 },
    async () => {
      process.env.CEREBRO_CLAUDE_PATH = fixture
      const model = (await adapters.claude.models('/tmp'))[0]
      const session = liveSession(model, 'background')
      const updates: BackgroundTaskUpdate[] = []
      const followup: AgentDelta[] = []
      let settled: (error?: Error) => void = () => {}
      const finished = new Promise<Error | undefined>((resolve) => {
        settled = resolve
      })
      const connection = adapters.claude.connect(session, {
        ...idleHost,
        task: (update) => updates.push(update),
        autonomous: () => ({
          context: {
            session,
            signal: new AbortController().signal,
            emit: (e) => followup.push(e),
            ask: async () => ({ allow: false, answers: {} })
          },
          settle: settled
        })
      })
      try {
        const events: AgentDelta[] = []
        await connection.run({
          session,
          text: failed ? 'background-task-fail' : 'background-task',
          signal: new AbortController().signal,
          emit: (e) => events.push(e),
          ask: async () => ({ allow: false, answers: {} })
        })
        assert(replies(events).includes('Background task is running.'))
        assert.equal(await finished, undefined)
        assert(
          replies(followup).includes(
            failed ? 'Background task failed with exit code 3.' : 'Background task finished: /tmp'
          )
        )
        const { endedAt, ...outcome } = updates[2]
        assert.deepEqual(updates.slice(0, 2), [
          { id: 'task-test', title: 'Delayed pwd', status: 'running' },
          { id: 'task-test', status: 'running', itemId: 'tool-bg' }
        ])
        assert.deepEqual(
          outcome,
          failed
            ? {
                id: 'task-test',
                status: 'failed',
                summary: 'Background command "Delayed pwd" failed with exit code 3',
                exitCode: 3
              }
            : {
                id: 'task-test',
                status: 'completed',
                summary: 'Background command "Delayed pwd" completed (exit code 0)',
                exitCode: 0
              }
        )
        assert.equal(typeof endedAt, 'number')
        assert.equal(updates.length, 3)
      } finally {
        connection.close()
      }
    }
  )

for (const failed of [false, true])
  test(
    `Codex: a background terminal that ${failed ? 'fails' : 'succeeds'} keeps its item running and reports its outcome`,
    { timeout: 15_000 },
    async () => {
      process.env.CEREBRO_CODEX_PATH = fixture
      const model = (await adapters.codex.models('/tmp'))[0]
      const session = liveSession(model, 'background')
      const updates: BackgroundTaskUpdate[] = []
      const idle: AgentDelta[] = []
      const connection = adapters.codex.connect(session, {
        ...idleHost,
        task: (update) => updates.push(update),
        idle: (e) => idle.push(e)
      })
      try {
        await connection.run({
          session,
          text: failed ? 'background-command-fail' : 'background-command',
          signal: new AbortController().signal,
          emit: () => {},
          ask: async () => ({ allow: false, answers: {} })
        })
        const { startedAt, ...running } = updates[0]
        assert.deepEqual(running, {
          id: 'bg-command',
          title: 'sleep 1; pwd',
          status: 'running',
          itemId: 'bg-command'
        })
        assert.equal(typeof startedAt, 'number')
        await waitFor(() => updates.length === 2)
        const { endedAt, ...outcome } = updates[1]
        assert.deepEqual(outcome, {
          id: 'bg-command',
          status: failed ? 'failed' : 'completed',
          exitCode: failed ? 3 : 0
        })
        assert.equal(typeof endedAt, 'number')
        const output = idle.find(
          (e) => e.type === 'item' && e.item.id === 'bg-command' && e.item.status
        )
        assert(output?.type === 'item')
        assert.equal(output.item.text, '/tmp\n')
        assert.equal(output.item.status, failed ? 'failed' : 'completed')
      } finally {
        connection.close()
      }
    }
  )

test(
  'codex plan updates replace the checklist and ignore another thread',
  { timeout: 15_000 },
  async () => {
    process.env.CEREBRO_CODEX_PATH = fixture
    const model = (await adapters.codex.models('/tmp'))[0]
    const events: AgentDelta[] = []
    await runTurn(adapters.codex, {
      session: liveSession(model, 'plans'),
      text: 'plan-replace',
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      ask: async () => ({ allow: false, answers: {} })
    })
    const todos = events.flatMap((event) => (event.type === 'todo' ? [event.todo] : []))
    assert.deepEqual(
      todos.map((todo) => todo.items.map((item) => item.label)),
      [['One'], ['One', 'Two']]
    )
    assert.equal(todos[0]?.explanation, 'First pass.')
    assert.deepEqual(todos[1], {
      kind: 'todo',
      listId: 'session:plans:todo',
      explanation: 'Second pass.',
      items: [
        { id: '0', label: 'One', status: 'completed' },
        { id: '1', label: 'Two', status: 'in_progress' }
      ]
    })
    const foreign: AgentDelta[] = []
    await runTurn(adapters.codex, {
      session: liveSession(model, 'foreign'),
      text: 'plan-foreign',
      signal: new AbortController().signal,
      emit: (event) => foreign.push(event),
      ask: async () => ({ allow: false, answers: {} })
    })
    assert.equal(
      foreign.some((event) => event.type === 'todo'),
      false
    )
    const cleared: AgentDelta[] = []
    await runTurn(adapters.codex, {
      session: liveSession(model, 'cleared'),
      text: 'plan-clear',
      signal: new AbortController().signal,
      emit: (event) => cleared.push(event),
      ask: async () => ({ allow: false, answers: {} })
    })
    const empty = cleared.find((event) => event.type === 'todo')
    assert(empty?.type === 'todo')
    assert.deepEqual(empty.todo.items, [])
    assert.equal(
      cleared.some((event) => event.type === 'item' && event.item.kind === 'plan'),
      false
    )
  }
)

test(
  'Claude: a child frame becomes a sub-agent, and a checklist tool does not',
  { timeout: 15_000 },
  async () => {
    process.env.CEREBRO_CLAUDE_PATH = fixture
    const model = (await adapters.claude.models('/tmp'))[0]
    const updates: SubagentUpdate[] = []
    const tasks: BackgroundTaskUpdate[] = []
    const events: AgentDelta[] = []
    await runTurn(
      adapters.claude,
      {
        session: liveSession(model, 'subagent'),
        text: 'subagent',
        signal: new AbortController().signal,
        emit: (event) => events.push(event),
        ask: async () => ({ allow: false, answers: {} })
      },
      {
        subagent: (update) => updates.push(update),
        task: (update) => tasks.push(update)
      }
    )
    assert.deepEqual(updates, [
      { id: 'tool-sub', status: 'running', title: 'Review the diff' },
      {
        id: 'tool-sub',
        status: 'completed',
        tokens: { input: 12104, output: 6316, total: 18420 }
      }
    ])
    assert.equal(tasks.length, 0)
    assert.equal(
      events.some(
        (event) => event.type === 'item' && event.item.text?.includes('Looking at the diff.')
      ),
      false
    )
    assert.ok(replies(events).includes('Review finished.'))
    const ignored: SubagentUpdate[] = []
    await runTurn(
      adapters.claude,
      {
        session: liveSession(model, 'tasks-not-children'),
        text: 'tasks',
        signal: new AbortController().signal,
        emit: () => {},
        ask: async () => ({ allow: false, answers: {} })
      },
      { subagent: (update) => ignored.push(update) }
    )
    assert.equal(ignored.length, 0)
  }
)

test(
  'Claude: agent tasks leave the background list, and child frames stay out of the transcript',
  { timeout: 15_000 },
  async () => {
    process.env.CEREBRO_CLAUDE_PATH = fixture
    const model = (await adapters.claude.models('/tmp'))[0]
    const updates: SubagentUpdate[] = []
    const tasks: BackgroundTaskUpdate[] = []
    const events: AgentDelta[] = []
    await runTurn(
      adapters.claude,
      {
        session: liveSession(model, 'agent-and-shell'),
        text: 'agent-and-shell',
        signal: new AbortController().signal,
        emit: (event) => events.push(event),
        ask: async () => ({ allow: false, answers: {} })
      },
      {
        subagent: (update) => updates.push(update),
        task: (update) => tasks.push(update)
      }
    )
    assert.deepEqual([...new Set(tasks.map((task) => task.id))], ['bash-1'])
    const folded = new Map<string, SubagentUpdate>()
    for (const update of updates) {
      const previous = folded.get(update.id)
      folded.set(update.id, {
        ...previous,
        ...update,
        ...(update.tokens || previous?.tokens
          ? { tokens: { ...previous?.tokens, ...update.tokens } }
          : {})
      })
    }
    const review = folded.get('agent-1')
    assert.equal(review?.status, 'completed')
    assert.equal(review?.title, 'Review the diff')
    assert.deepEqual(review?.tokens, { total: 18420 })
    assert.equal(review?.durationMs, 153000)
    assert.equal(review?.finishedAt! - review?.startedAt!, 153000)
    assert.equal(
      updates.some(
        (update) =>
          update.id === 'agent-1' && update.status === 'running' && update.durationMs === 120000
      ),
      true
    )
    const remote = folded.get('agent-2')
    assert.equal(remote?.status, 'running')
    assert.equal(remote?.title, 'Remote review')
    assert.equal(remote?.tokens, undefined)
    assert.equal(folded.has('bash-1'), false)
    assert.equal(
      events.some(
        (event) => event.type === 'item' && event.item.text?.includes('Looking at the diff.')
      ),
      false
    )
    assert.equal(
      events.some((event) => event.type === 'item' && event.item.title === 'WebSearch'),
      false
    )
    assert.equal(
      events.some((event) => event.type === 'item' && event.item.kind === 'notice'),
      false
    )
    assert.ok(replies(events).includes('Review finished.'))
  }
)

test(
  'Codex: a collab child is a sub-agent, and another thread is ignored',
  { timeout: 15_000 },
  async () => {
    process.env.CEREBRO_CODEX_PATH = fixture
    const model = (await adapters.codex.models('/tmp'))[0]
    const updates: SubagentUpdate[] = []
    const tasks: BackgroundTaskUpdate[] = []
    const events: AgentDelta[] = []
    await runTurn(
      adapters.codex,
      {
        session: liveSession(model, 'codex-subagent'),
        text: 'subagent',
        signal: new AbortController().signal,
        emit: (event) => events.push(event),
        ask: async () => ({ allow: false, answers: {} })
      },
      {
        subagent: (update) => updates.push(update),
        task: (update) => tasks.push(update)
      }
    )
    const folded = new Map<string, SubagentUpdate>()
    for (const update of updates) {
      const previous = folded.get(update.id)
      folded.set(update.id, {
        ...previous,
        ...update,
        ...(update.tokens || previous?.tokens
          ? { tokens: { ...previous?.tokens, ...update.tokens } }
          : {})
      })
    }
    const child = folded.get('child-thread')
    assert.equal(child?.status, 'completed')
    assert.equal(child?.title, 'Review the diff')
    assert.equal(child?.model, 'gpt-test')
    assert.deepEqual(child?.tokens, { input: 12104, output: 6316, total: 18420 })
    assert.equal(child?.startedAt, 1_700_000_000_000)
    assert.equal(child?.finishedAt, 1_700_000_000_000 + 153000)
    const childUpdates = updates.filter((update) => update.id === 'child-thread')
    assert.equal(childUpdates[0]?.startedAt, 1_700_000_000_000)
    assert.ok(
      childUpdates.every(
        (update) => update.startedAt === undefined || update.startedAt === 1_700_000_000_000
      )
    )
    const otherUpdates = updates.filter((update) => update.id === 'other-child')
    assert.ok(otherUpdates.length > 0)
    assert.ok(
      otherUpdates.every(
        (update) =>
          update.startedAt === undefined &&
          update.finishedAt === undefined &&
          update.durationMs === undefined
      )
    )
    const other = folded.get('other-child')
    assert.equal(other?.status, 'running')
    assert.equal(folded.has('foreign-thread'), false)
    assert.equal(folded.has('thread-other'), false)
    assert.equal(tasks.length, 0)
    assert.equal(
      events.some(
        (event) =>
          event.type === 'item' &&
          (event.item.title === 'subAgentActivity' || event.item.title === 'collabAgentToolCall')
      ),
      false
    )
    assert.ok(replies(events).includes('Review finished.'))
  }
)

test(
  'claude task results keep the task id and the session opts into Task tools',
  { timeout: 15_000 },
  async () => {
    process.env.CEREBRO_CLAUDE_PATH = fixture
    const model = (await adapters.claude.models('/tmp'))[0]
    const events: AgentDelta[] = []
    await runTurn(adapters.claude, {
      session: liveSession(model, 'tasks'),
      text: 'tasks',
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      ask: async () => ({ allow: false, answers: {} })
    })
    const todos = events.flatMap((event) => (event.type === 'todo' ? [event.todo] : []))
    assert.equal(todos[0]?.items[0]?.id, 'toolu_create')
    assert.deepEqual(todos.at(-1), {
      kind: 'todo',
      listId: 'session:tasks:todo',
      items: [
        {
          id: '1',
          label: 'Inspect',
          status: 'in_progress',
          activeLabel: 'Inspecting the workspace'
        }
      ]
    })
    const opted: AgentDelta[] = []
    await runTurn(adapters.claude, {
      session: liveSession(model, 'opt-in'),
      text: 'todo-opt-in',
      signal: new AbortController().signal,
      emit: (event) => opted.push(event),
      ask: async () => ({ allow: false, answers: {} })
    })
    const replies = opted.flatMap((event) =>
      event.type === 'item' && event.item.kind === 'text' && event.item.text
        ? [event.item.text]
        : []
    )
    assert.equal(replies.at(-1), '1')
  }
)
