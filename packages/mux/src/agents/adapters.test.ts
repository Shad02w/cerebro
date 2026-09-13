import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { adapters } from './adapters'
import type { AgentDelta, AgentHarness, AgentSession } from '@cerebro/core'
const fixture = resolve(__dirname, 'fixtures/fake-harness.cjs')
for (const harness of ['claude', 'codex', 'pi'] as AgentHarness[]) {
  test(
    `${harness}: native model discovery, streamed response, resume binding and teardown`,
    { timeout: 15_000 },
    async () => {
      process.env[`CEREBRO_${harness.toUpperCase()}_PATH`] = fixture
      const models = await adapters[harness].models('/tmp')
      assert.equal(models[0].label, 'Test Model')
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
      await adapters[harness].run({
        session,
        text: 'hello',
        signal: new AbortController().signal,
        emit: (e) => events.push(e),
        ask: async () => ({ allow: false, answers: {} })
      })
      assert(events.some((e) => e.type === 'binding' && e.nativeId))
      assert(events.some((e) => e.type === 'item' && e.item.text.includes('Adapter connected.')))
      assert(events.some((e) => e.type === 'item' && e.append === true))
    }
  )
}
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
      nativeId: 'thread-test'
    } as AgentSession
    let asked = false
    await adapters.codex.run({
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
    const running = adapters.codex.run({
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

test(
  'Claude SDK permission callbacks round-trip through native control messages',
  { timeout: 15000 },
  async () => {
    const model = (await adapters.claude.models('/tmp'))[0]
    let asked = false
    await adapters.claude.run({
      session: {
        version: 1,
        id: 'logical',
        workspaceId: 1,
        repositoryId: null,
        cwd: '/tmp',
        title: 'Approval',
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
