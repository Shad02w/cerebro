import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentModel, ChatItem } from '@cerebro/core'
import { messageToResend } from './model-switch'

function model(
  partial: Pick<AgentModel, 'key' | 'harness' | 'provider'> & Partial<AgentModel>
): AgentModel {
  return {
    instance: 'local',
    id: partial.key,
    label: partial.key,
    source: 'native',
    available: true,
    reasoning: [],
    ...partial
  }
}

const claudeA = model({ key: 'sonnet', harness: 'claude', provider: 'configured' })
const claudeB = model({ key: 'opus', harness: 'claude', provider: 'configured' })
const codexA = model({ key: 'gpt', harness: 'codex', provider: 'configured' })
const codexB = model({ key: 'gpt-mini', harness: 'codex', provider: 'configured' })
const piA = model({ key: 'pi-a', harness: 'pi', provider: 'openai' })
const piB = model({ key: 'pi-b', harness: 'pi', provider: 'openai' })

const sent: Array<Pick<ChatItem, 'kind' | 'text' | 'attachments'>> = [
  { kind: 'user', text: 'glyph the branch' },
  { kind: 'text', text: 'done' }
]

test('restores the last prompt when Claude or Codex changes model under the same provider', () => {
  assert.equal(
    messageToResend({
      composerText: '',
      attachmentCount: 0,
      current: claudeA,
      next: claudeB,
      items: sent
    }),
    'glyph the branch'
  )
  assert.equal(
    messageToResend({
      composerText: '   ',
      attachmentCount: 0,
      current: codexA,
      next: codexB,
      items: sent
    }),
    'glyph the branch'
  )
})

test('leaves a typed draft, a different harness, and Pi model switches alone', () => {
  assert.equal(
    messageToResend({
      composerText: 'a new thought',
      attachmentCount: 0,
      current: claudeA,
      next: claudeB,
      items: sent
    }),
    null
  )
  assert.equal(
    messageToResend({
      composerText: '',
      attachmentCount: 1,
      current: claudeA,
      next: claudeB,
      items: sent
    }),
    null
  )
  assert.equal(
    messageToResend({
      composerText: '',
      attachmentCount: 0,
      current: claudeA,
      next: codexA,
      items: sent
    }),
    null
  )
  assert.equal(
    messageToResend({
      composerText: '',
      attachmentCount: 0,
      current: piA,
      next: piB,
      items: sent
    }),
    null
  )
  assert.equal(
    messageToResend({
      composerText: '',
      attachmentCount: 0,
      current: claudeA,
      next: claudeA,
      items: sent
    }),
    null
  )
  assert.equal(
    messageToResend({
      composerText: '',
      attachmentCount: 0,
      current: claudeA,
      next: claudeB,
      items: [
        {
          kind: 'user',
          text: 'with image',
          attachments: [
            { id: 'img', kind: 'image', name: 'a.png', mimeType: 'image/png', bytes: 1 }
          ]
        }
      ]
    }),
    null
  )
})
