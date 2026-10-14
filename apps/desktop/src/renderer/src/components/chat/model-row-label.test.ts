import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modelRowLabel } from './model-row-label'

const row = (
  patch: Partial<{ key: string; label: string; provider: string; id: string }>
): { key: string; label: string; provider: string; id: string } => ({
  key: 'k',
  label: 'Sonnet 5.5',
  provider: 'configured',
  id: 'sonnet',
  ...patch
})

test('a Claude row is the model name, without the harness or the wire id', () => {
  const sonnet = row({ key: 'sonnet', id: 'sonnet' })
  assert.equal(
    modelRowLabel(row({ key: 'opus', label: 'Opus 5.5', id: 'opus' }), [sonnet]),
    'Opus 5.5'
  )
  assert.equal(modelRowLabel(sonnet, [sonnet]), 'Sonnet 5.5')
})

test('two Claude rows that share a name keep the id that is not already in the name', () => {
  const named = row({ key: 'sonnet', id: 'sonnet' })
  const alias = row({ key: 'default', id: 'default' })
  assert.equal(modelRowLabel(named, [named, alias]), 'Sonnet 5.5')
  assert.equal(modelRowLabel(alias, [named, alias]), 'Sonnet 5.5 · default')
})

test('a Pi row names the provider when the model name does not', () => {
  const model = row({
    key: 'pi',
    label: 'Claude Sonnet',
    provider: 'anthropic',
    id: 'claude-sonnet'
  })
  assert.equal(modelRowLabel(model, [model]), 'Claude Sonnet · anthropic')
  const named = row({
    key: 'named',
    label: 'Anthropic Claude Sonnet',
    provider: 'anthropic',
    id: 'claude-sonnet'
  })
  assert.equal(modelRowLabel(named, [named]), 'Anthropic Claude Sonnet')
})

test('the same Pi model from two providers shows the provider, not a repeated id', () => {
  const anthropic = row({
    key: 'anthropic',
    label: 'Claude Sonnet',
    provider: 'anthropic',
    id: 'claude-sonnet'
  })
  const openrouter = row({
    key: 'openrouter',
    label: 'Claude Sonnet',
    provider: 'openrouter',
    id: 'claude-sonnet'
  })
  assert.equal(modelRowLabel(anthropic, [anthropic, openrouter]), 'Claude Sonnet · anthropic')
  assert.equal(modelRowLabel(openrouter, [anthropic, openrouter]), 'Claude Sonnet · openrouter')
})
