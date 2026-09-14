import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
      const checkpoint = events.find((e) => e.type === 'checkpoint')
      if (harness === 'claude')
        assert.deepEqual(checkpoint, {
          type: 'checkpoint',
          turnId: undefined,
          chainId: 'chain-test'
        })
      else assert.equal(checkpoint, undefined)
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
      nativeId: 'thread-test',
      accessMode: 'edit'
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

for (const harness of ['claude', 'codex', 'pi'] as const) {
  test(`${harness}: access settings reach native startup and resume`, async () => {
    process.env[`CEREBRO_${harness.toUpperCase()}_PATH`] = fixture
    const model = (await adapters[harness].models('/tmp'))[0]
    for (const accessMode of [undefined, 'full', 'edit', 'read'] as const) {
      for (const nativeId of [undefined, 'saved-session']) {
        const events: AgentDelta[] = []
        await adapters[harness].run({
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
      await adapters[harness].run({
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
