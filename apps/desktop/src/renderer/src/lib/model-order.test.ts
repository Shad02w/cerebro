import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentHarness, AgentModel } from '@cerebro/core'
import { sortAgentModels } from './model-order'

function entry(harness: AgentHarness, provider: string, id: string, label = id): AgentModel {
  return {
    key: `${harness}:${provider}:${id}`,
    instance: 'local',
    harness,
    provider,
    id,
    label,
    source: 'native',
    available: true,
    reasoning: []
  }
}

test('Claude lists the newest version first and the strongest family inside it', () => {
  const labels = sortAgentModels([
    entry('claude', 'configured', 'claude-opus-4-7', 'Opus 4.7'),
    entry('claude', 'configured', 'claude-opus-4-8', 'Opus 4.8'),
    entry('claude', 'configured', 'claude-opus-5', 'Opus 5'),
    entry('claude', 'configured', 'opus', 'Opus 5.5'),
    entry('claude', 'configured', 'claude-sonnet-4-6', 'Sonnet 4.6'),
    entry('claude', 'configured', 'claude-sonnet-5', 'Sonnet 5'),
    entry('claude', 'configured', 'default', 'Sonnet 5.5'),
    entry('claude', 'configured', 'claude-haiku-4-5-20251001', 'Haiku 4.5'),
    entry('claude', 'configured', 'claude-fable-5', 'Fable 5')
  ]).map((model) => model.label)

  assert.deepEqual(labels, [
    'Opus 5.5',
    'Sonnet 5.5',
    'Fable 5',
    'Opus 5',
    'Sonnet 5',
    'Opus 4.8',
    'Opus 4.7',
    'Sonnet 4.6',
    'Haiku 4.5'
  ])
})

test('Codex lists the newest GPT version first and the full model ahead of smaller ones', () => {
  const ids = sortAgentModels([
    entry('codex', 'configured', 'gpt-5.3-codex'),
    entry('codex', 'configured', 'gpt-5.4-mini'),
    entry('codex', 'configured', 'gpt-5.4'),
    entry('codex', 'configured', 'gpt-5.5'),
    entry('codex', 'configured', 'gpt-5.1-codex-max'),
    entry('codex', 'configured', 'gpt-5-codex')
  ]).map((model) => model.id)

  assert.deepEqual(ids, [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.1-codex-max',
    'gpt-5-codex'
  ])
})

test('Pi sorts inside each provider and keeps provider blocks in catalog order', () => {
  const ids = sortAgentModels([
    entry('pi', 'anthropic', 'claude-opus-4-7', 'Opus 4.7'),
    entry('pi', 'openai', 'gpt-5.4-mini', 'GPT-5.4 mini'),
    entry('pi', 'anthropic', 'claude-sonnet-5', 'Sonnet 5'),
    entry('pi', 'openai', 'gpt-5.5', 'GPT-5.5'),
    entry('pi', 'google', 'gemini-2.5-flash', 'Gemini 2.5 Flash'),
    entry('pi', 'google', 'gemini-2.5-pro', 'Gemini 2.5 Pro'),
    entry('pi', 'google', 'gemini-3-pro', 'Gemini 3 Pro')
  ]).map((model) => model.id)

  assert.deepEqual(ids, [
    'claude-sonnet-5',
    'claude-opus-4-7',
    'gpt-5.5',
    'gpt-5.4-mini',
    'gemini-3-pro',
    'gemini-2.5-pro',
    'gemini-2.5-flash'
  ])
})

test('router ids follow the vendor pattern, and dates are not versions', () => {
  const ids = sortAgentModels([
    entry('pi', 'openrouter', 'mistralai/mistral-small-2603', 'Mistral Small 4'),
    entry('pi', 'openrouter', 'openai/gpt-5.4-mini:batch', 'GPT-5.4 Mini (batch)'),
    entry('pi', 'openrouter', 'openai/gpt-5.4', 'GPT-5.4'),
    entry('pi', 'openrouter', 'openai/gpt-5.4-pro', 'GPT-5.4 Pro'),
    entry('pi', 'openrouter', 'anthropic/claude-opus-4.8', 'Claude Opus 4.8'),
    entry('pi', 'openrouter', 'anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5'),
    entry('pi', 'openrouter', 'google/gemini-2.5-flash', 'Gemini 2.5 Flash'),
    entry('pi', 'openrouter', 'google/gemini-2.5-pro', 'Gemini 2.5 Pro'),
    entry('pi', 'openrouter', 'openai/gpt-oss-120b', 'gpt-oss-120b')
  ]).map((model) => model.id)

  assert.deepEqual(ids, [
    'anthropic/claude-sonnet-5.5',
    'openai/gpt-5.4-pro',
    'openai/gpt-5.4',
    'openai/gpt-5.4-mini:batch',
    'anthropic/claude-opus-4.8',
    'google/gemini-2.5-pro',
    'google/gemini-2.5-flash',
    'mistralai/mistral-small-2603',
    'openai/gpt-oss-120b'
  ])
})

test('models with no version stay after the ranked ones, in their original order', () => {
  const labels = sortAgentModels([
    entry('claude', 'configured', '', 'Native default'),
    entry('claude', 'configured', 'claude-sonnet-5', 'Sonnet 5'),
    entry('claude', 'configured', 'custom', 'Custom')
  ]).map((model) => model.label)

  assert.deepEqual(labels, ['Sonnet 5', 'Native default', 'Custom'])
})
