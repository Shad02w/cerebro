import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AgentModel } from './chat'
import {
  defaultModelForScope,
  reconcileAgentPreferences,
  rememberAgentModel,
  resolveNewAgentModel
} from './agent-defaults'

const model = (
  harness: AgentModel['harness'],
  provider: string,
  id: string,
  extra: Partial<AgentModel> = {}
): AgentModel => ({
  key: JSON.stringify([harness, 'local', provider, id]),
  instance: 'local',
  harness,
  provider,
  id,
  label: extra.label ?? id,
  source: 'native',
  available: extra.available ?? true,
  reasoning: [],
  ...extra
})

const claudeA = model('claude', 'configured', 'fable', { label: 'Fable' })
const claudeB = model('claude', 'configured', 'sonnet', { label: 'Sonnet' })
const codexA = model('codex', 'configured', 'gpt', { label: 'GPT' })
const piA = model('pi', 'openai', 'a', { label: 'A' })
const piB = model('pi', 'anthropic', 'b', { label: 'B' })
const catalog = [claudeA, claudeB, codexA, piA, piB]

test('a new pane uses the first model until a harness is remembered', () => {
  assert.equal(resolveNewAgentModel(catalog, {}, null), claudeA)
  assert.equal(
    resolveNewAgentModel(catalog, { claude: { configured: claudeB.key } }, null)?.key,
    claudeB.key
  )
})

test('a new pane reuses the last harness and its saved model', () => {
  const picked = resolveNewAgentModel(
    catalog,
    { pi: { openai: piA.key } },
    { harness: 'pi', provider: 'openai' }
  )
  assert.equal(picked, piA)
})

test('a removed model falls back to that provider’s current default', () => {
  const resolved = resolveNewAgentModel(
    catalog,
    { claude: { configured: 'gone' } },
    { harness: 'claude', provider: 'configured' }
  )
  assert.equal(resolved, claudeA)
  const repaired = reconcileAgentPreferences(
    catalog,
    { claude: { configured: 'gone' }, codex: { configured: codexA.key } },
    { harness: 'claude', provider: 'configured' }
  )
  assert.equal(repaired.changed, true)
  assert.equal(repaired.agentModelDefaults.claude?.configured, claudeA.key)
  assert.equal(repaired.agentModelDefaults.codex?.configured, codexA.key)
  assert.deepEqual(repaired.lastAgent, { harness: 'claude', provider: 'configured' })
})

test('a removed provider keeps the harness and uses another provider’s default', () => {
  const repaired = reconcileAgentPreferences(
    catalog,
    { pi: { openai: piA.key, missing: 'gone' } },
    { harness: 'pi', provider: 'missing' }
  )
  assert.equal(repaired.agentModelDefaults.pi?.openai, piA.key)
  assert.equal(repaired.agentModelDefaults.pi?.missing, undefined)
  assert.equal(repaired.lastAgent?.harness, 'pi')
  assert.equal(repaired.lastAgent?.provider, 'openai')
  assert.equal(resolveNewAgentModel(catalog, repaired.agentModelDefaults, repaired.lastAgent), piA)
})

test('a removed harness clears the memory and uses the catalog default', () => {
  const onlyClaude = [claudeA]
  const repaired = reconcileAgentPreferences(
    onlyClaude,
    { codex: { configured: codexA.key } },
    { harness: 'codex', provider: 'configured' }
  )
  assert.deepEqual(repaired.agentModelDefaults, {})
  assert.equal(repaired.lastAgent, null)
  assert.equal(
    resolveNewAgentModel(onlyClaude, repaired.agentModelDefaults, repaired.lastAgent),
    claudeA
  )
})

test('remembering a model stores it for that provider and is a no-op when unchanged', () => {
  const first = rememberAgentModel({ agentModelDefaults: {}, lastAgent: null }, claudeB)
  assert.deepEqual(first?.lastAgent, { harness: 'claude', provider: 'configured' })
  assert.equal(first?.agentModelDefaults.claude?.configured, claudeB.key)
  assert.equal(rememberAgentModel(first!, claudeB), null)
  const next = rememberAgentModel(first!, piB)
  assert.equal(next?.agentModelDefaults.claude?.configured, claudeB.key)
  assert.equal(next?.agentModelDefaults.pi?.anthropic, piB.key)
  assert.deepEqual(next?.lastAgent, { harness: 'pi', provider: 'anthropic' })
})

test('an unavailable saved model yields the provider’s available default', () => {
  const offline = model('claude', 'configured', 'fable', { available: false, label: 'Fable' })
  const online = model('claude', 'configured', 'sonnet', { label: 'Sonnet' })
  assert.equal(
    defaultModelForScope(
      [offline, online],
      { claude: { configured: offline.key } },
      'claude',
      'configured'
    ),
    online
  )
  const repaired = reconcileAgentPreferences(
    [offline, online],
    { claude: { configured: offline.key } },
    { harness: 'claude', provider: 'configured' }
  )
  assert.equal(repaired.agentModelDefaults.claude?.configured, online.key)
})

test('settings persist agent defaults and reject an unknown harness', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cerebro-agent-defaults-'))
  process.env.CEREBRO_HOME = home
  process.env.CEREBRO_DB_PATH = join(home, 'cerebro.sqlite')
  const { getSettings, setSettings } = await import('./settings')
  const initial = getSettings()
  assert.deepEqual(initial.agentModelDefaults, {})
  assert.equal(initial.lastAgent, null)
  const saved = setSettings({
    agentModelDefaults: { claude: { configured: claudeB.key } },
    lastAgent: { harness: 'claude', provider: 'configured' }
  })
  assert.equal(saved.agentModelDefaults.claude?.configured, claudeB.key)
  assert.deepEqual(getSettings().lastAgent, { harness: 'claude', provider: 'configured' })
  assert.throws(
    () => setSettings({ agentModelDefaults: { grok: { configured: 'x' } } as never }),
    /Unknown agent harness/
  )
  assert.equal(getSettings().agentModelDefaults.claude?.configured, claudeB.key)
  const cleared = setSettings({ lastAgent: null })
  assert.equal(cleared.lastAgent, null)
  assert.equal(cleared.agentModelDefaults.claude?.configured, claudeB.key)
})
