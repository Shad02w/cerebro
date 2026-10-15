import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentModel } from '@cerebro/core'
import {
  claudeAliasSelection,
  claudeDefaultAliasTarget,
  collapseClaudeDefaultAliases
} from './claude-default-alias'

function model(id: string, label: string, patch: Partial<AgentModel> = {}): AgentModel {
  return {
    key: JSON.stringify(['claude', 'local', 'configured', id]),
    instance: 'local',
    harness: 'claude',
    provider: 'configured',
    id,
    label,
    source: 'native',
    available: true,
    reasoning: [],
    ...patch
  }
}

const sonnet = model('sonnet', 'Sonnet 5.5')
const accountDefault = model('default', 'Default (recommended) · Sonnet 5.5')
const opus = model('opus', 'Opus 5.5')

test('the account default is the same row as the model it names', () => {
  const catalog = [opus, accountDefault, sonnet]
  assert.equal(claudeDefaultAliasTarget(accountDefault, catalog), sonnet)
  assert.equal(claudeDefaultAliasTarget(sonnet, catalog), undefined)
  assert.deepEqual(
    collapseClaudeDefaultAliases(catalog, catalog).map((entry) => entry.id),
    ['opus', 'sonnet']
  )
  assert.equal(claudeAliasSelection(accountDefault, catalog).id, 'sonnet')
  assert.equal(claudeAliasSelection(opus, catalog).id, 'opus')
})

test('a default alias with no named model stays in the list', () => {
  const only = model('default', 'Default (recommended)')
  assert.equal(claudeDefaultAliasTarget(only, [only]), undefined)
  assert.deepEqual(collapseClaudeDefaultAliases([only], [only]), [only])
})

test('a default whose label is already the model name collapses into that row', () => {
  const alias = model('default', 'Sonnet 5.5')
  const catalog = [alias, sonnet]
  assert.equal(claudeDefaultAliasTarget(alias, catalog), sonnet)
  assert.deepEqual(
    collapseClaudeDefaultAliases(catalog, catalog).map((entry) => entry.id),
    ['sonnet']
  )
})

test('a saved default follows the catalog label when the account default moves', () => {
  const stale = model('default', 'Default (recommended) · Sonnet 5.5')
  const fresh = model('default', 'Default (recommended) · Opus 5.5')
  const catalog = [fresh, opus, sonnet]
  assert.equal(claudeAliasSelection(stale, catalog).id, 'opus')
})

test('a favorited default alias shows as the model it names, once', () => {
  const catalog = [accountDefault, sonnet]
  assert.deepEqual(
    collapseClaudeDefaultAliases([accountDefault], catalog).map((entry) => entry.id),
    ['sonnet']
  )
  assert.deepEqual(
    collapseClaudeDefaultAliases([accountDefault, sonnet], catalog).map((entry) => entry.id),
    ['sonnet']
  )
})
