import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  adapters,
  claudeModelLabel,
  runTurn,
  type BackgroundTaskUpdate,
  type RunAttachment,
  type SubagentUpdate
} from './adapters'
import { claudeResumeOptions } from './adapters/claude'
import type { AgentDelta, AgentHarness, AgentSession } from '@cerebro/core'
import { codexAppServerPid, stopCodexAppServer } from './codex-server'
const fixture = resolve(__dirname, 'fixtures/fake-harness.cjs')
describe('agent adapters', { concurrency: 1 }, () => {
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
    // The account default and the sonnet alias both resolve to Sonnet 5.5. Name the model
    // on the default alias so the picker can collapse the two rows into Sonnet 5.5.
    assert.equal(
      claudeModelLabel({
        value: 'default',
        displayName: 'Default',
        description: 'Sonnet 5.5 · Efficient for routine tasks · $2/$10 per Mtok',
        resolvedModel: 'claude-sonnet-5-5'
      }),
      'Default · Sonnet 5.5'
    )
    assert.equal(
      claudeModelLabel({
        value: 'default',
        displayName: 'Sonnet',
        description: 'Efficient for routine tasks · $2/$10 per Mtok',
        resolvedModel: 'claude-sonnet-5-5'
      }),
      'Default · Sonnet 5.5'
    )
    assert.equal(
      claudeModelLabel({
        value: 'sonnet',
        displayName: 'Sonnet',
        description: 'Sonnet 5.5 · Efficient for routine tasks · $2/$10 per Mtok',
        resolvedModel: 'claude-sonnet-5-5'
      }),
      'Sonnet 5.5'
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
        assert(usage.usage.usedTokens != null && usage.usage.usedTokens > 0)
        assert(
          usage.usage.percentage != null &&
            usage.usage.percentage >= 0 &&
            usage.usage.percentage <= 100
        )
        if (harness === 'codex')
          assert.deepEqual(usage.usage, {
            usedTokens: 43759,
            contextWindow: 258400,
            percentage: 17,
            codex: { inputTokens: 42000, outputTokens: 1759 }
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
  test('claudeResumeOptions forks a rewound resume at the kept checkpoint', () => {
    assert.deepEqual(
      claudeResumeOptions({
        nativeId: 'native-claude',
        nativeResume: { at: 'chain-1', fork: true }
      }),
      { resume: 'native-claude', resumeSessionAt: 'chain-1', forkSession: true }
    )
    assert.deepEqual(claudeResumeOptions({ nativeId: 'native-claude' }), {
      resume: 'native-claude'
    })
    assert.deepEqual(claudeResumeOptions({}), {})
  })
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
  test('context popover fields survive the adapter', { timeout: 20_000 }, async () => {
    const sessionFor = (harness: AgentHarness, model: AgentSession['model']): AgentSession => ({
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
    })
    process.env.CEREBRO_CLAUDE_PATH = fixture
    const claudeEvents: AgentDelta[] = []
    await runTurn(adapters.claude, {
      session: sessionFor('claude', (await adapters.claude.models('/tmp'))[0]),
      text: 'context-popover-full',
      signal: new AbortController().signal,
      emit: (event) => claudeEvents.push(event),
      ask: async () => ({ allow: false, answers: {} })
    })
    const claude = claudeEvents.find((event) => event.type === 'usage')
    assert(claude?.type === 'usage')
    assert.equal(claude.usage.usedTokens, 70800)
    assert.equal(claude.usage.percentage, 35)
    assert.equal(
      claude.usage.claude?.categories.find((row) => row.tokens === 0)?.name,
      'Unused skills'
    )
    assert.equal(
      claude.usage.claude?.categories.find((row) => row.kind === 'deferred')?.name,
      'MCP tools (deferred)'
    )
    assert.equal(claude.usage.claude?.messageBreakdown?.userMessageTokens, 8600)
    assert.equal(JSON.stringify(claude.usage).includes('apiUsage'), false)

    process.env.CEREBRO_CODEX_PATH = fixture
    const codexEvents: AgentDelta[] = []
    await runTurn(adapters.codex, {
      session: sessionFor('codex', (await adapters.codex.models('/tmp'))[0]),
      text: 'context-popover-codex',
      signal: new AbortController().signal,
      emit: (event) => codexEvents.push(event),
      ask: async () => ({ allow: false, answers: {} })
    })
    const codex = codexEvents.find((event) => event.type === 'usage')
    assert(codex?.type === 'usage')
    assert.deepEqual(codex.usage, {
      usedTokens: 43550,
      contextWindow: 258400,
      percentage: 17,
      codex: {
        inputTokens: 42000,
        cachedInputTokens: 28400,
        cacheWriteInputTokens: 6200,
        outputTokens: 1550,
        reasoningOutputTokens: 480
      }
    })

    process.env.CEREBRO_PI_PATH = fixture
    const piEvents: AgentDelta[] = []
    await runTurn(adapters.pi, {
      session: sessionFor('pi', (await adapters.pi.models('/tmp'))[0]),
      text: 'context-popover-empty',
      signal: new AbortController().signal,
      emit: (event) => piEvents.push(event),
      ask: async () => ({ allow: false, answers: {} })
    })
    const pi = piEvents.find((event) => event.type === 'usage')
    assert(pi?.type === 'usage')
    assert.deepEqual(pi.usage, { usedTokens: null, contextWindow: 200000, percentage: null })
  })
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
        await waitFor(() =>
          events.some((e) => e.type === 'item' && e.item.text.includes('steer me'))
        )
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
          (e) =>
            e.type === 'item' && e.item.kind === 'text' && e.item.text.includes('REFUSED DRAFT')
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
        if (harness === 'codex') {
          const other = adapters.codex.connect(liveSession(model, 'live-b'), idleHost)
          const more: AgentDelta[] = []
          await other.run({
            session: liveSession(model, 'live-b'),
            text: 'pid',
            signal: new AbortController().signal,
            emit: (event) => more.push(event),
            ask: async () => ({ allow: false, answers: {} })
          })
          assert.equal(
            replies(more).find((text) => /^\d+$/.test(text)),
            pids[0]
          )
          other.close()
          connection.close()
          assert(alive(pid))
          return
        }
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

  test(
    'codex shows a retryable error and still finishes the turn',
    { timeout: 15_000 },
    async () => {
      process.env.CEREBRO_CODEX_PATH = fixture
      const model = (await adapters.codex.models('/tmp'))[0]
      const events: AgentDelta[] = []
      await runTurn(adapters.codex, {
        session: liveSession(model, 'retry'),
        text: 'retry-then-ok',
        signal: new AbortController().signal,
        emit: (event) => events.push(event),
        ask: async () => ({ allow: false, answers: {} })
      })
      const alert = events.find((event) => event.type === 'alert')
      assert.equal(alert?.type === 'alert' && alert.message, 'Model overloaded.')
      assert(replies(events).some((text) => text.includes('Adapter connected.')))
    }
  )

  test(
    'codex keeps the shared server up after a final thread error',
    { timeout: 15_000 },
    async () => {
      process.env.CEREBRO_CODEX_PATH = fixture
      const model = (await adapters.codex.models('/tmp'))[0]
      await assert.rejects(
        runTurn(adapters.codex, {
          session: liveSession(model, 'fatal'),
          text: 'fatal-error',
          signal: new AbortController().signal,
          emit: () => {},
          ask: async () => ({ allow: false, answers: {} })
        }),
        /Codex rejected the turn/
      )
      assert.equal((await adapters.codex.models('/tmp'))[0].label, 'Test Model')
    }
  )

  test('codex resume failure keeps the saved thread id', { timeout: 15_000 }, async () => {
    process.env.CEREBRO_CODEX_PATH = fixture
    const model = (await adapters.codex.models('/tmp'))[0]
    const events: AgentDelta[] = []
    await assert.rejects(
      runTurn(adapters.codex, {
        session: { ...liveSession(model, 'missing'), nativeId: 'missing-thread' },
        text: 'hello',
        signal: new AbortController().signal,
        emit: (event) => events.push(event),
        ask: async () => ({ allow: false, answers: {} })
      }),
      /Thread not found/
    )
    assert.equal(
      events.some((event) => event.type === 'binding'),
      false
    )
  })

  test(
    'codex resumes the saved thread after the app server stops',
    { timeout: 15_000 },
    async () => {
      process.env.CEREBRO_CODEX_PATH = fixture
      const model = (await adapters.codex.models('/tmp'))[0]
      const opened: AgentDelta[] = []
      const session = liveSession(model, 'reopen')
      await runTurn(adapters.codex, {
        session,
        text: 'hello',
        signal: new AbortController().signal,
        emit: (event) => opened.push(event),
        ask: async () => ({ allow: false, answers: {} })
      })
      const binding = opened.find((event) => event.type === 'binding')
      assert(binding?.type === 'binding' && binding.nativeId)
      stopCodexAppServer()
      const resumed: AgentDelta[] = []
      await runTurn(adapters.codex, {
        session: { ...session, nativeId: binding.nativeId },
        text: 'hello',
        signal: new AbortController().signal,
        emit: (event) => resumed.push(event),
        ask: async () => ({ allow: false, answers: {} })
      })
      assert(replies(resumed).some((text) => text.startsWith('Resumed native session.')))
    }
  )

  test(
    'codex shows a process crash and the next turn resumes that thread',
    { timeout: 15_000 },
    async () => {
      process.env.CEREBRO_CODEX_PATH = fixture
      const model = (await adapters.codex.models('/tmp'))[0]
      const opened: AgentDelta[] = []
      const session = liveSession(model, 'crash')
      await assert.rejects(
        runTurn(adapters.codex, {
          session,
          text: 'crash',
          signal: new AbortController().signal,
          emit: (event) => opened.push(event),
          ask: async () => ({ allow: false, answers: {} })
        }),
        /Agent exited/
      )
      const binding = opened.find((event) => event.type === 'binding')
      assert(binding?.type === 'binding' && binding.nativeId)
      const resumed: AgentDelta[] = []
      await runTurn(adapters.codex, {
        session: { ...session, nativeId: binding.nativeId },
        text: 'hello',
        signal: new AbortController().signal,
        emit: (event) => resumed.push(event),
        ask: async () => ({ allow: false, answers: {} })
      })
      assert(replies(resumed).some((text) => text.startsWith('Resumed native session.')))
    }
  )

  test(
    'each harness lists skills and receives that harness’s prompt form',
    { timeout: 20_000 },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'cerebro-skill-wire-'))
      const home = mkdtempSync(join(tmpdir(), 'cerebro-skill-home-'))
      const previousHome = process.env.CEREBRO_SKILL_HOME
      process.env.CEREBRO_SKILL_HOME = home
      try {
        mkdirSync(join(directory, '.claude', 'skills', 'review'), { recursive: true })
        writeFileSync(
          join(directory, '.claude', 'skills', 'review', 'SKILL.md'),
          '---\nname: review\ndescription: Review the diff\n---\n'
        )
        mkdirSync(join(directory, '.claude', 'plugins', 'formatter', 'skills', 'lint'), {
          recursive: true
        })
        writeFileSync(
          join(directory, '.claude', 'plugins', 'formatter', 'skills', 'lint', 'SKILL.md'),
          '---\nname: lint\ndescription: Lint with the plugin\n---\n'
        )
        for (const harness of ['claude', 'codex', 'pi'] as AgentHarness[]) {
          process.env[`CEREBRO_${harness.toUpperCase()}_PATH`] = fixture
          const listed = await adapters[harness].skills?.(directory)
          const review = listed?.find((skill) => skill.name === 'review')
          const token = '/review'
          const prompt =
            harness === 'pi' ? '/skill:review' : harness === 'claude' ? '/review' : '$review'
          assert.equal(review?.token, token)
          assert.equal(review?.prompt, prompt)
          if (harness === 'claude') {
            const plugin = listed?.find((skill) => skill.name === 'formatter:lint')
            assert.equal(plugin?.description, 'Lint with the plugin')
            assert.equal(plugin?.token, '/formatter:lint')
            assert.equal(plugin?.prompt, '/formatter:lint')
          }
          const models = await adapters[harness].models(directory)
          const events: AgentDelta[] = []
          await runTurn(adapters[harness], {
            session: { ...liveSession(models[0], `skill-${harness}`), cwd: directory },
            text: `skill-wire ${token} please`,
            skills: [
              {
                name: 'review',
                path: review?.path || '/tmp/skills/review/SKILL.md',
                token,
                prompt
              }
            ],
            signal: new AbortController().signal,
            emit: (event) => events.push(event),
            ask: async () => ({ allow: false, answers: {} })
          })
          const reply = events
            .flatMap((event) => (event.type === 'item' && event.item.text ? [event.item.text] : []))
            .join('')
          if (harness === 'codex') {
            const input = JSON.parse(reply) as Array<{
              type?: string
              text?: string
              name?: string
            }>
            assert.equal(input[0]?.text, 'skill-wire $review please')
            assert.equal(
              input.some((item) => item.type === 'skill'),
              false
            )
          } else {
            assert.match(reply, new RegExp(prompt.replaceAll('/', '\\/')))
            assert.doesNotMatch(reply, /@review/)
          }
        }
      } finally {
        if (previousHome === undefined) delete process.env.CEREBRO_SKILL_HOME
        else process.env.CEREBRO_SKILL_HOME = previousHome
        rmSync(directory, { recursive: true, force: true })
        rmSync(home, { recursive: true, force: true })
      }
    }
  )

  test(
    'Codex and Pi list commands and run the built-ins through their own calls',
    { timeout: 20_000 },
    async () => {
      process.env.CEREBRO_CODEX_PATH = fixture
      process.env.CEREBRO_PI_PATH = fixture
      const names = async (harness: AgentHarness): Promise<string[]> =>
        ((await adapters[harness].commands?.('/tmp')) ?? []).map((entry) => entry.name)
      assert.deepEqual(await names('codex'), ['compact', 'review', 'rename', 'init'])
      // Skills stay in the skill picker; templates and Pi's missing built-ins join the list.
      assert.deepEqual(await names('pi'), ['compact', 'export', 'fix-tests', 'name', 'new'])

      const run = async (harness: AgentHarness, text: string): Promise<AgentDelta[]> => {
        const models = await adapters[harness].models('/tmp')
        const events: AgentDelta[] = []
        await runTurn(adapters[harness], {
          session: liveSession(models[0], `command-${harness}`),
          text,
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
          ask: async () => ({ allow: false, answers: {} })
        })
        return events
      }
      const shown = (events: AgentDelta[]): string =>
        events
          .flatMap((event) => (event.type === 'item' && event.item.text ? [event.item.text] : []))
          .join('')

      assert.match(shown(await run('pi', '/compact')), /Compacted .*12,345 tokens/)
      assert.match(shown(await run('pi', '/name Release')), /Session named “Release”/)
      await assert.rejects(run('pi', '/name'), /Usage: \/name <name>/)
      // A prompt template is not a built-in, so Pi receives it as the prompt.
      assert.match(shown(await run('pi', '/fix-tests now')), /Adapter connected/)

      assert.match(shown(await run('codex', '/compact')), /compact-ran/)
      assert.match(shown(await run('codex', '/rename Release')), /Thread renamed to “Release”/)
      // `/init` becomes an ordinary turn carrying the instructions Codex's TUI would send.
      assert.match(shown(await run('codex', '/init')), /Adapter connected/)
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
        {
          id: 'tool-sub',
          status: 'running',
          title: 'Review the diff',
          model: 'opus',
          effort: 'max'
        },
        {
          id: 'tool-sub',
          status: 'completed',
          tokens: { input: 12104, output: 6316, total: 18420 },
          announce: true
        }
      ])
      assert.equal(tasks.length, 0)
      assert.equal(
        events.some(
          (event) => event.type === 'item' && event.item.text?.includes('Looking at the diff.')
        ),
        false
      )
      assert.equal(
        events.some((event) => event.type === 'item' && event.item.text?.includes('reviewed')),
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
      const remote = folded.get('agent-2')
      assert.equal(review?.status, 'completed')
      assert.equal(review?.title, 'Review the diff')
      assert.deepEqual(review?.tokens, { total: 18420 })
      assert.equal(review?.durationMs, 153000)
      assert.equal(review?.finishedAt! - review?.startedAt!, 153000)
      assert.equal(review?.model, 'sonnet')
      assert.equal(review?.effort, 'high')
      assert.equal(remote?.model, undefined)
      assert.equal(remote?.effort, undefined)
      assert.equal(
        updates.some((update) => update.model === 'test' || update.model === 'parent-model'),
        false
      )
      assert.equal(
        updates.some(
          (update) =>
            update.id === 'agent-1' && update.status === 'running' && update.durationMs === 120000
        ),
        true
      )
      assert.equal(
        updates.find((update) => update.id === 'agent-1' && update.status === 'completed')
          ?.announce,
        true
      )
      assert.equal(
        updates.some((update) => update.status === 'running' && update.announce),
        false
      )
      assert.equal(
        updates.some((update) => update.id === 'agent-2' && update.announce),
        false
      )
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

  test('Claude: a child frame is not the parent result', { timeout: 15_000 }, async () => {
    process.env.CEREBRO_CLAUDE_PATH = fixture
    const model = (await adapters.claude.models('/tmp'))[0]
    const session = liveSession(model, 'one-response')
    const events: AgentDelta[] = []
    const updates: SubagentUpdate[] = []
    let wakes = 0
    let settled = false
    const connection = adapters.claude.connect(session, {
      ...idleHost,
      subagent: (update) => updates.push(update),
      autonomous: () => {
        wakes += 1
        return undefined
      }
    })
    try {
      const done = connection
        .run({
          session,
          text: 'one-response',
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
          ask: async () => ({ allow: false, answers: {} })
        })
        .then(() => {
          settled = true
        })
      await waitFor(() =>
        replies(events).includes(
          'Three research agents are running. I will consolidate when they report back.'
        )
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(settled, false)
      assert.equal(wakes, 0)
      await done
      assert.equal(wakes, 0)
      assert.deepEqual(replies(events), [
        'Three research agents are running. I will consolidate when they report back.',
        'Tooling findings. The other agent is still running.',
        'Final recommendation.'
      ])
      const finished = updates.filter((update) => update.announce)
      assert.deepEqual(
        finished.map((update) => [update.id, update.durationMs, update.model, update.effort]),
        [
          ['agent-tooling', 57000, 'sonnet', 'high'],
          ['agent-blogs', 42000, 'sonnet', 'medium']
        ]
      )
    } finally {
      connection.close()
    }
  })

  test(
    'Claude: SendMessage reopens an ended child, and its shells stay off the session',
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
          session: liveSession(model, 'agent-resume'),
          text: 'agent-resume',
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
          ask: async () => ({ allow: false, answers: {} })
        },
        { subagent: (update) => updates.push(update), task: (update) => tasks.push(update) }
      )
      assert.deepEqual([...new Set(updates.map((update) => update.id))], ['agent-plan'])
      const edges = updates
        .filter((update) => update.announce || update.reopen)
        .map((update) => ({
          status: update.status,
          durationMs: update.durationMs,
          reopen: update.reopen
        }))
      assert.deepEqual(edges, [
        { status: 'completed', durationMs: 180000, reopen: undefined },
        { status: 'running', durationMs: undefined, reopen: true },
        { status: 'completed', durationMs: 3518000, reopen: undefined }
      ])
      const reopened = updates.findIndex((update) => update.reopen)
      const finished = updates.map((update) => update.status).lastIndexOf('completed')
      assert.equal(
        updates
          .slice(reopened, finished)
          .every((update) => update.status === 'running' && !update.announce),
        true
      )
      assert.deepEqual(tasks, [])
      const sent = events.find(
        (event) => event.type === 'item' && event.item.id === 'tool-send' && event.item.text
      )
      assert.equal(sent?.type === 'item' && sent.item.text, 'Resuming agent agent-plan')
    }
  )

  test(
    'Claude: a background launch, a progress update, and a 0s duration are not a finish',
    { timeout: 15_000 },
    async () => {
      process.env.CEREBRO_CLAUDE_PATH = fixture
      const model = (await adapters.claude.models('/tmp'))[0]
      const running: SubagentUpdate[] = []
      const events: AgentDelta[] = []
      await runTurn(
        adapters.claude,
        {
          session: liveSession(model, 'agents-still-running'),
          text: 'agents-still-running',
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
          ask: async () => ({ allow: false, answers: {} })
        },
        { subagent: (update) => running.push(update) }
      )
      assert.equal(
        running.some((update) => update.announce || update.status !== 'running'),
        false
      )
      assert.deepEqual([...new Set(running.map((update) => update.id))].sort(), [
        'agent-blogs',
        'agent-community',
        'agent-github'
      ])
      const blogs = running.filter((update) => update.id === 'agent-blogs')
      assert.equal(
        blogs.some((update) => update.durationMs === 16000),
        true
      )
      assert.equal(
        blogs.some((update) => update.model === 'sonnet' && update.effort === 'medium'),
        true
      )
      assert.equal(
        events.some(
          (event) =>
            event.type === 'item' &&
            event.item.text?.includes('Blogs report that must stay off the transcript.')
        ),
        false
      )
      const finished: SubagentUpdate[] = []
      await runTurn(
        adapters.claude,
        {
          session: liveSession(model, 'agents-then-finish'),
          text: 'agents-then-finish',
          signal: new AbortController().signal,
          emit: () => {},
          ask: async () => ({ allow: false, answers: {} })
        },
        { subagent: (update) => finished.push(update) }
      )
      const done = finished.filter((update) => update.status === 'completed')
      assert.equal(done.length, 1)
      assert.equal(done[0]?.id, 'agent-community')
      assert.equal(done[0]?.announce, true)
      assert.equal(done[0]?.durationMs, 31000)
      assert.equal(done[0]?.model, 'sonnet')
      assert.equal(done[0]?.effort, 'high')
      assert.deepEqual(done[0]?.tokens, { total: 18420 })
      assert.equal(
        finished.some((update) => update.id !== 'agent-community' && update.announce),
        false
      )
      assert.equal(
        finished.some((update) => update.id === 'agent-blogs' && update.status !== 'running'),
        false
      )
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
      assert.equal(child?.effort, 'high')
      assert.deepEqual(child?.tokens, { input: 12104, output: 6316, total: 18420 })
      assert.equal(child?.startedAt, 1_700_000_000_000)
      assert.equal(child?.finishedAt, 1_700_000_000_000 + 153000)
      const childUpdates = updates.filter((update) => update.id === 'child-thread')
      assert.equal(childUpdates[0]?.startedAt, 1_700_000_000_000)
      assert.equal(childUpdates[0]?.model, 'gpt-test')
      assert.equal(childUpdates[0]?.effort, 'high')
      assert.equal(
        updates.some((update) => update.model === 'parent-model'),
        false
      )
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
            update.durationMs === undefined &&
            update.model === undefined &&
            update.effort === undefined
        )
      )
      assert.equal(childUpdates.find((update) => update.status === 'completed')?.announce, true)
      assert.equal(
        childUpdates
          .filter((update) => update.status !== 'completed')
          .every((update) => !update.announce),
        true
      )
      assert.equal(
        otherUpdates.every((update) => !update.announce),
        true
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
    'Codex: item/completed and a 0s duration do not finish a child that is still running',
    { timeout: 15_000 },
    async () => {
      process.env.CEREBRO_CODEX_PATH = fixture
      const model = (await adapters.codex.models('/tmp'))[0]
      const updates: SubagentUpdate[] = []
      await runTurn(
        adapters.codex,
        {
          session: liveSession(model, 'codex-still-running'),
          text: 'agents-still-running',
          signal: new AbortController().signal,
          emit: () => {},
          ask: async () => ({ allow: false, answers: {} })
        },
        { subagent: (update) => updates.push(update) }
      )
      assert.equal(
        updates.some((update) => update.announce || update.status !== 'running'),
        false
      )
      const zero = [...updates].reverse().find((update) => update.id === 'child-zero')
      assert.equal(zero?.status, 'running')
      assert.equal(zero?.durationMs, undefined)
      const open = [...updates].reverse().find((update) => update.id === 'child-open')
      assert.equal(open?.status, 'running')
      assert.equal(
        updates.some((update) => update.id === 'child-open' && update.durationMs === 16000),
        true
      )
      assert.equal(
        updates.some((update) => update.id === 'child-missing' && update.status !== 'running'),
        false
      )
    }
  )

  test('Codex: a child item is not turn/completed', { timeout: 15_000 }, async () => {
    process.env.CEREBRO_CODEX_PATH = fixture
    const model = (await adapters.codex.models('/tmp'))[0]
    const session = liveSession(model, 'child-not-turn')
    const events: AgentDelta[] = []
    let wakes = 0
    let settled = false
    const connection = adapters.codex.connect(session, {
      ...idleHost,
      autonomous: () => {
        wakes += 1
        return undefined
      }
    })
    try {
      const done = connection
        .run({
          session,
          text: 'child-not-turn',
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
          ask: async () => ({ allow: false, answers: {} })
        })
        .then(() => {
          settled = true
        })
      await waitFor(() => replies(events).includes('Parent still writing after the child.'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(settled, false)
      assert.equal(wakes, 0)
      await done
      assert.equal(wakes, 0)
      assert.deepEqual(replies(events), [
        'Parent still writing after the child.',
        'Parent recommendation.'
      ])
    } finally {
      connection.close()
    }
  })

  test('Pi: tool_execution_end is not agent_end', { timeout: 15_000 }, async () => {
    process.env.CEREBRO_PI_PATH = fixture
    const model = (await adapters.pi.models('/tmp'))[0]
    const session = liveSession(model, 'pi-not-end')
    const events: AgentDelta[] = []
    let wakes = 0
    let settled = false
    const connection = adapters.pi.connect(session, {
      ...idleHost,
      autonomous: () => {
        wakes += 1
        return undefined
      }
    })
    try {
      const done = connection
        .run({
          session,
          text: 'pi-not-end',
          signal: new AbortController().signal,
          emit: (event) => events.push(event),
          ask: async () => ({ allow: false, answers: {} })
        })
        .then(() => {
          settled = true
        })
      await waitFor(() => replies(events).includes('Parent still writing.'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(settled, false)
      assert.equal(wakes, 0)
      await done
      assert.equal(wakes, 0)
      assert.ok(replies(events).includes('Parent still writing.'))
      assert.ok(replies(events).includes('Parent done.'))
    } finally {
      connection.close()
    }
  })

  after(async () => {
    const pid = codexAppServerPid()
    stopCodexAppServer()
    if (pid) await waitFor(() => !alive(pid))
  })
})
