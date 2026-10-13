import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatItem } from '@cerebro/core'
import { transcriptEntries } from './tool-groups'

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
    ['u', ['a', 'b'], 'r', 't']
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
