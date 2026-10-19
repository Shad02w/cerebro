import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatItem } from '@cerebro/core'
import {
  heldTurnIds,
  outcomeTurnIds,
  transcriptEntries,
  transcriptTurnIds,
  watchedTurns,
  workingAnchorId
} from './tool-groups'

const item = (patch: Partial<ChatItem> & Pick<ChatItem, 'id' | 'kind'>): ChatItem => ({
  turnId: 'turn',
  text: '',
  ...patch
})

test('folds every tool call in a turn into one group', () => {
  const entries = transcriptEntries([
    item({ id: 'u', kind: 'user', text: 'go' }),
    item({ id: 'a', kind: 'tool', title: 'Read' }),
    item({ id: 'r', kind: 'reasoning', text: 'hmm' }),
    item({ id: 'b', kind: 'tool', title: 'Bash' }),
    item({ id: 't', kind: 'text', text: 'done' })
  ])
  assert.deepEqual(
    entries.map((entry) =>
      entry.type === 'item' ? entry.item.id : entry.items.map((tool) => tool.id)
    ),
    ['u', ['a', 'r', 'b'], 't']
  )
  assert.equal(entries[1].type === 'tools' && entries[1].live, false)
})

test('keeps the group open while its turn is streaming', () => {
  const entries = transcriptEntries(
    [
      item({ id: 'a', kind: 'tool', title: 'Read' }),
      item({ id: 'b', kind: 'tool', turnId: 'other', title: 'Bash' })
    ],
    'turn'
  )
  assert.equal(entries[0].type === 'tools' && entries[0].live, true)
  assert.equal(entries[1].type === 'tools' && entries[1].live, false)
})

test('folds reasoning into the same Working section as the tool calls', () => {
  const entries = transcriptEntries([
    item({ id: 'u', kind: 'user', text: 'go' }),
    item({ id: 'r1', kind: 'reasoning', text: 'first' }),
    item({ id: 'a', kind: 'tool', title: 'Skill' }),
    item({ id: 'r2', kind: 'reasoning', text: 'second' }),
    item({ id: 't', kind: 'text', text: 'done' })
  ])
  assert.deepEqual(
    entries.map((entry) =>
      entry.type === 'item' ? entry.item.id : entry.items.map((tool) => tool.id)
    ),
    ['u', ['r1', 'a', 'r2'], 't']
  )
  assert.equal(workingAnchorId(entries, 'turn'), 'r1')
})

test('keeps every transcript turn id, including the session turn', () => {
  assert.deepEqual(
    transcriptTurnIds(
      [item({ id: 'u', kind: 'user' }), item({ id: 'r', kind: 'reasoning', turnId: 'other' })],
      'turn'
    ),
    ['turn', 'other']
  )
})

test('times the session turn and any tool or reasoning turn while busy', () => {
  assert.deepEqual(
    watchedTurns(
      [item({ id: 'u', kind: 'user' }), item({ id: 'r', kind: 'reasoning', turnId: 'other' })],
      true,
      'turn'
    ),
    ['turn', 'other']
  )
  assert.deepEqual(watchedTurns([item({ id: 'a', kind: 'tool' })], false, 'turn'), [])
})

test('places Working above the first tool call and message of the live turn', () => {
  const entries = transcriptEntries([
    item({ id: 'u', kind: 'user', text: 'go' }),
    item({ id: 'a', kind: 'tool', title: 'Read' }),
    item({ id: 't', kind: 'text', text: 'done' }),
    item({ id: 'old', kind: 'text', turnId: 'earlier', text: 'before' })
  ])
  assert.equal(workingAnchorId(entries, 'turn'), 'a')
  assert.equal(
    workingAnchorId(
      transcriptEntries([
        item({ id: 'u', kind: 'user', text: 'go' }),
        item({ id: 't', kind: 'text', text: 'done' }),
        item({ id: 'a', kind: 'tool', title: 'Read' })
      ]),
      'turn'
    ),
    't'
  )
  assert.equal(
    workingAnchorId(transcriptEntries([item({ id: 'u', kind: 'user', text: 'go' })]), 'turn'),
    null
  )
})

test('holds End of response from the turn that started running work', () => {
  const items = [
    item({ id: 'one:u', kind: 'user', turnId: 'one' }),
    item({ id: 'one:t', kind: 'text', turnId: 'one' }),
    item({ id: 'two:u', kind: 'user', turnId: 'two' }),
    item({ id: 'two:bash', kind: 'tool', turnId: 'two' }),
    item({ id: 'three:u', kind: 'user', turnId: 'three' }),
    item({ id: 'three:t', kind: 'text', turnId: 'three' })
  ]
  assert.deepEqual([...heldTurnIds(items, {})], [])
  assert.deepEqual(
    [...heldTurnIds(items, { subagents: [{ status: 'completed', turnId: 'one' }] })],
    []
  )
  assert.deepEqual(
    [...heldTurnIds(items, { subagents: [{ status: 'running', turnId: 'two' }] })],
    ['two', 'three']
  )
  assert.deepEqual(
    [...heldTurnIds(items, { background: [{ status: 'running', itemId: 'bash' }] })],
    ['two', 'three']
  )
  assert.deepEqual(
    [
      ...heldTurnIds(items, {
        subagents: [{ status: 'running', turnId: 'three' }],
        background: [{ status: 'running', itemId: 'bash' }]
      })
    ],
    ['two', 'three']
  )
  assert.deepEqual([...heldTurnIds(items, { subagents: [{ status: 'running' }] })], ['three'])
})

test('a turn of only agent or task outcomes is not a response', () => {
  const agent = { id: 'child', title: 'Plan', status: 'completed' as const, createdAt: 1 }
  const task = { id: 'shell', title: 'sleep', status: 'completed' as const, startedAt: 1 }
  const ids = outcomeTurnIds([
    item({ id: 'one:u', kind: 'user', turnId: 'one' }),
    item({ id: 'one:agent', kind: 'notice', turnId: 'one', agent }),
    item({ id: 'one:t', kind: 'text', turnId: 'one' }),
    item({ id: 'idle:agent', kind: 'notice', turnId: 'idle', agent }),
    item({ id: 'idle:task', kind: 'notice', turnId: 'idle', task }),
    item({ id: 'later:task', kind: 'notice', turnId: 'later', task }),
    item({ id: 'later:t', kind: 'text', turnId: 'later' })
  ])
  assert.deepEqual([...ids], ['idle'])
})
