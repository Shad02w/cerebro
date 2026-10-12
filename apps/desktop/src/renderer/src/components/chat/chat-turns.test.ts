import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activeChatTurn,
  chatTurnAnchorItemIds,
  chatTurnSummaries,
  flattenChatPreview,
  isTranscriptAtEnd
} from './chat-turns'

const items = [
  { id: 'u1', turnId: 't1', kind: 'user', text: 'First **question**' },
  { id: 'a1', turnId: 't1', kind: 'text', text: '**Done.**\n\n- One detail' },
  { id: 'tool', turnId: 't1', kind: 'tool', text: 'ignored' },
  { id: 'u2', turnId: 't2', kind: 'user', text: 'Second question' },
  { id: 'a2', turnId: 't2', kind: 'text', text: 'Still writing' }
]

test('summarizes turns from top to bottom and hides an in-flight response as unfinished', () => {
  const turns = chatTurnSummaries(items, { busyTurnId: 't2' })
  assert.deepEqual(
    turns.map((turn) => turn.turnId),
    ['t1', 't2']
  )
  assert.equal(turns[0].prompt, 'First question')
  assert.equal(turns[0].response, 'Done. One detail')
  assert.equal(turns[0].finished, true)
  assert.equal(turns[1].prompt, 'Second question')
  assert.equal(turns[1].response, 'Still writing')
  assert.equal(turns[1].finished, false)
})

test('marks every turn finished when nothing is running', () => {
  const turns = chatTurnSummaries(items)
  assert.equal(
    turns.every((turn) => turn.finished),
    true
  )
})

test('anchors the first item of each turn', () => {
  assert.deepEqual(chatTurnAnchorItemIds(items.map(({ id, turnId }) => ({ id, turnId }))), [
    'u1',
    'u2'
  ])
})

test('flattens markdown and truncates long previews', () => {
  assert.equal(
    flattenChatPreview('```ts\nconst n = 1\n```\nSee [docs](https://example.com).'),
    'See docs.'
  )
  const turns = chatTurnSummaries([{ turnId: 't', kind: 'user', text: 'word '.repeat(80) }])
  assert.equal(turns[0].prompt.endsWith('…'), true)
  assert.equal(turns[0].prompt.length <= 180, true)
})

test('treats the last 80 pixels as the end of the transcript', () => {
  assert.equal(isTranscriptAtEnd(1000, 920, 100), true)
  assert.equal(isTranscriptAtEnd(1000, 800, 100), false)
  assert.equal(isTranscriptAtEnd(200, 0, 200), true)
})

test('picks the turn that has reached the top of the viewport', () => {
  const anchors = [
    { turnId: 't2', top: 400 },
    { turnId: 't1', top: 100 },
    { turnId: 't3', top: 700 }
  ]
  assert.equal(activeChatTurn([], 0), null)
  assert.equal(activeChatTurn(anchors, 90), 't1')
  assert.equal(activeChatTurn(anchors, 420), 't2')
  assert.equal(activeChatTurn(anchors, 800), 't3')
})
