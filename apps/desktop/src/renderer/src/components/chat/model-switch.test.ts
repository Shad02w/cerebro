import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentHarness, AgentModel } from '@cerebro/core'
import { modelSwitchNotice } from './model-switch'

function model(
  partial: Pick<AgentModel, 'key' | 'harness' | 'label'> & Partial<AgentModel>
): AgentModel {
  return {
    instance: 'local',
    provider: 'configured',
    id: partial.key,
    source: 'native',
    available: true,
    reasoning: [],
    ...partial
  }
}

const harnesses: AgentHarness[] = ['claude', 'codex']
const sonnet = model({ key: 'sonnet', harness: 'claude', label: 'Sonnet 5.5' })
const opus = model({ key: 'opus', harness: 'claude', label: 'Opus 5.5' })
const gpt = model({ key: 'gpt', harness: 'codex', label: 'GPT-5.5' })
const gptMini = model({ key: 'gpt-mini', harness: 'codex', label: 'GPT-5.5 mini' })
const piA = model({ key: 'pi-a', harness: 'pi', label: 'Pi A', provider: 'openai' })
const piB = model({ key: 'pi-b', harness: 'pi', label: 'Pi B', provider: 'openai' })

test('a live model change names the new model and the lost prompt cache', () => {
  assert.equal(
    modelSwitchNotice({ current: sonnet, next: opus, sessionStarted: true }),
    'Now using Opus 5.5. This conversation stays, but its prompt cache starts over — the next message re-reads the full context.'
  )
  assert.equal(
    modelSwitchNotice({ current: gpt, next: gptMini, sessionStarted: true }),
    'Now using GPT-5.5 mini. This conversation stays, but its prompt cache starts over — the next message re-reads the full context.'
  )
})

test('nothing is announced before a session, for the same model, or across harnesses', () => {
  assert.equal(modelSwitchNotice({ current: sonnet, next: opus, sessionStarted: false }), null)
  assert.equal(modelSwitchNotice({ current: undefined, next: opus, sessionStarted: true }), null)
  assert.equal(modelSwitchNotice({ current: sonnet, next: sonnet, sessionStarted: true }), null)
  assert.equal(modelSwitchNotice({ current: sonnet, next: gpt, sessionStarted: true }), null)
})

test('Pi model changes are not announced; its notice is not this one', () => {
  assert.equal(modelSwitchNotice({ current: piA, next: piB, sessionStarted: true }), null)
})

test('picking between a Claude default alias and the model it names is not a change', () => {
  const alias = model({
    key: 'default',
    harness: 'claude',
    id: 'default',
    label: 'Default · Sonnet 5.5'
  })
  const named = sonnet
  assert.equal(
    modelSwitchNotice({
      current: alias,
      next: named,
      sessionStarted: true,
      models: [alias, named]
    }),
    null
  )
  assert.equal(
    modelSwitchNotice({
      current: named,
      next: alias,
      sessionStarted: true,
      models: [alias, named]
    }),
    null
  )
})

test('every notified harness is one that keeps the conversation', () => {
  for (const harness of harnesses) {
    const first = model({ key: `${harness}-a`, harness, label: 'A' })
    const second = model({ key: `${harness}-b`, harness, label: 'B' })
    assert.ok(modelSwitchNotice({ current: first, next: second, sessionStarted: true }))
  }
})
