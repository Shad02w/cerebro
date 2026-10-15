import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import type { AgentHarness, AgentModel } from '@cerebro/core'
import {
  completeTitle,
  sanitizeTitle,
  suggestThreadTitle,
  threadTitleLimit,
  threadTitleSlice,
  titleModel,
  titlePrompt
} from './title'
import { codexAppServerPid, stopCodexAppServer } from './codex-server'

const model = (
  harness: AgentHarness,
  id: string,
  provider = 'configured',
  extra: Partial<AgentModel> = {}
): AgentModel => ({
  key: `${harness}:${provider}:${id}`,
  instance: 'local',
  harness,
  provider,
  id,
  label: id,
  source: 'native',
  available: true,
  reasoning: [],
  ...extra
})

test('threadTitleSlice trims and cuts at 70 characters', () => {
  assert.equal(threadTitleSlice('  hello  '), 'hello')
  assert.equal(threadTitleSlice('a'.repeat(80)).length, threadTitleLimit)
  assert.equal(threadTitleSlice(`  ${'a'.repeat(80)}`), 'a'.repeat(threadTitleLimit))
})

test('titleModel uses the hardcoded id, then the one fallback, then nothing', () => {
  assert.deepEqual(titleModel([model('claude', 'claude-haiku-5-5')], 'claude'), {
    harness: 'claude',
    id: 'claude-haiku-5-5',
    provider: 'configured'
  })
  assert.equal(
    titleModel([model('claude', 'haiku'), model('claude', 'claude-haiku-4-5-20251001')], 'claude')
      ?.id,
    'haiku'
  )
  assert.equal(
    titleModel([model('claude', 'claude-haiku-4-5-20251001')], 'claude')?.id,
    'claude-haiku-4-5-20251001'
  )
  assert.equal(titleModel([model('claude', 'claude-opus-5')], 'claude'), null)
  assert.equal(
    titleModel([model('claude', 'claude-haiku-5-5', 'configured', { available: false })], 'claude'),
    null
  )
  assert.equal(
    titleModel(
      [model('claude', 'claude-haiku-5-5', 'configured', { source: 'fallback' })],
      'claude'
    ),
    null
  )
  assert.deepEqual(titleModel([model('codex', 'gpt-5.6-luna')], 'codex'), {
    harness: 'codex',
    id: 'gpt-5.6-luna',
    provider: 'configured'
  })
  assert.equal(titleModel([model('codex', 'gpt-5.4-mini')], 'codex'), null)
  assert.deepEqual(titleModel([model('pi', 'gpt-5.6-luna', 'openai-codex')], 'pi'), {
    harness: 'pi',
    id: 'gpt-5.6-luna',
    provider: 'openai-codex'
  })
  assert.equal(titleModel([model('pi', 'gpt-5.6-luna', 'anthropic')], 'pi'), null)
  assert.equal(titleModel([model('pi', 'gpt-6-luna', 'openai-codex')], 'pi'), null)
})

test('titlePrompt is the user message, then the user message plus the first response', () => {
  const first = titlePrompt('rename the button')
  assert.match(first, /rename the button/)
  assert.doesNotMatch(first, /Assistant:/)
  const second = titlePrompt('rename the button', 'The button is now called Save.')
  assert.match(second, /User:\nrename the button/)
  assert.match(second, /Assistant:\nThe button is now called Save\./)
  assert.equal(titlePrompt(`${'x'.repeat(5000)}`).includes('x'.repeat(4001)), false)
})

test('sanitizeTitle keeps one short line and drops anything else', () => {
  assert.equal(sanitizeTitle('  "Fix login"  '), 'Fix login')
  assert.equal(sanitizeTitle("  'Fix login'  "), 'Fix login')
  assert.equal(sanitizeTitle('`Fix login`'), 'Fix login')
  assert.equal(sanitizeTitle('a'.repeat(90))?.length, threadTitleLimit)
  assert.equal(sanitizeTitle(''), null)
  assert.equal(sanitizeTitle('   '), null)
  assert.equal(sanitizeTitle('one\ntwo'), null)
  assert.equal(sanitizeTitle('"'), null)
})

test('suggestThreadTitle does not call a harness when the cheap model is absent', async () => {
  assert.equal(
    await suggestThreadTitle({
      harness: 'codex',
      models: [model('codex', 'gpt-5.5')],
      user: 'hello'
    }),
    null
  )
})

const fixture = resolve(__dirname, 'fixtures/fake-harness.cjs')
for (const harness of ['claude', 'codex', 'pi'] as const) {
  test(
    `${harness} title call reads a one-line reply from a fresh process`,
    { timeout: 20_000 },
    async () => {
      process.env[`CEREBRO_${harness.toUpperCase()}_PATH`] = fixture
      const text = await completeTitle(
        {
          harness,
          id: 'pid',
          provider: harness === 'pi' ? 'openai-codex' : 'configured'
        },
        'pid'
      )
      assert.match(text.trim(), /^\d+$/)
    }
  )
}

after(async () => {
  const pid = codexAppServerPid()
  stopCodexAppServer()
  if (!pid) return
  const start = Date.now()
  while (Date.now() - start < 5000) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Codex app-server did not exit.')
})
