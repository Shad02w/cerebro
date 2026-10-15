import assert from 'node:assert/strict'
import { test } from 'node:test'
import { threadTitleLimit } from '../../../../../../packages/mux/src/agents/title'
import { defaultChatTabLabel, generatedTabLabel, promptTabLabel } from './thread-tab-title'

const prompt = 'so i want to know what are the top 10 fav pi agent plugins, search it and list them'

test('the prompt slice uses the mux title limit', () => {
  assert.equal(threadTitleLimit, 70)
  const long = 'x'.repeat(threadTitleLimit + 10)
  assert.equal(
    generatedTabLabel({
      tabLabel: promptTabLabel(long),
      sessionTitle: long.trim().slice(0, threadTitleLimit),
      prompt: long
    }),
    null
  )
})

test('a generated title replaces the prompt, the slice, and the default Agent label', () => {
  const title = 'Favorite Pi plugins'
  assert.equal(
    generatedTabLabel({ tabLabel: promptTabLabel(prompt), sessionTitle: title, prompt }),
    title
  )
  assert.equal(
    generatedTabLabel({
      tabLabel: prompt.trim().slice(0, threadTitleLimit),
      sessionTitle: title,
      prompt
    }),
    title
  )
  assert.equal(
    generatedTabLabel({ tabLabel: defaultChatTabLabel, sessionTitle: title, prompt }),
    title
  )
})

test('a placeholder slice that ends on a space does not replace the prompt', () => {
  const text = `${'word '.repeat(14)}tail`
  const slice = text.slice(0, threadTitleLimit)
  assert.equal(slice.endsWith(' '), true)
  assert.equal(
    generatedTabLabel({ tabLabel: promptTabLabel(text), sessionTitle: slice, prompt: text }),
    null
  )
  assert.equal(
    generatedTabLabel({ tabLabel: slice, sessionTitle: 'Short title', prompt: text }),
    'Short title'
  )
})

test('a later pass replaces the previous automatic title and leaves a rename alone', () => {
  assert.equal(
    generatedTabLabel({
      tabLabel: 'Favorite Pi plugins',
      sessionTitle: 'Pi agent plugins',
      prompt,
      previousSessionTitle: 'Favorite Pi plugins'
    }),
    'Pi agent plugins'
  )
  assert.equal(
    generatedTabLabel({
      tabLabel: 'My notes',
      sessionTitle: 'Pi agent plugins',
      prompt,
      previousSessionTitle: 'Favorite Pi plugins'
    }),
    null
  )
  assert.equal(
    generatedTabLabel({ tabLabel: 'Pi agent plugins', sessionTitle: 'Pi agent plugins', prompt }),
    null
  )
})
