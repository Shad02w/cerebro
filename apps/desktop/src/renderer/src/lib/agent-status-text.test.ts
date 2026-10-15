import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentStatusLabel, relativeUpdated, workingForLabel } from './agent-status-text'

const now = 1_700_000_000_000

test('working clock uses seconds, then minutes, then hours', () => {
  assert.equal(workingForLabel(undefined, now), 'Working')
  assert.equal(workingForLabel(now - 12_000, now), 'Working for 12s')
  assert.equal(workingForLabel(now - 120_000, now), 'Working for 2m')
  assert.equal(workingForLabel(now - (60 + 4) * 60_000, now), 'Working for 1h 4m')
})

test('sidebar status words are the agent status, not the workspace status', () => {
  assert.equal(agentStatusLabel({ status: 'idle' }, now), null)
  assert.deepEqual(agentStatusLabel({ status: 'running', runningSince: now - 120_000 }, now), {
    text: 'Working for 2m',
    color: 'text-sky-500',
    aria: 'Agent running'
  })
  assert.equal(agentStatusLabel({ status: 'running' }, now)?.text, 'Working')
  assert.equal(
    agentStatusLabel({ status: 'waiting', requestKind: 'approval' }, now)?.text,
    'Needs approval'
  )
  assert.equal(
    agentStatusLabel({ status: 'waiting', requestKind: 'question' }, now)?.text,
    'Needs an answer'
  )
  assert.equal(agentStatusLabel({ status: 'waiting' }, now)?.text, 'Needs approval')
  assert.equal(agentStatusLabel({ status: 'finished' }, now)?.text, 'Done')
  assert.equal(agentStatusLabel({ status: 'failed' }, now)?.text, 'Failed')
  assert.equal(agentStatusLabel({ status: 'interrupted' }, now)?.text, 'Interrupted')
  assert.equal(relativeUpdated(now - 30_000, now), 'just now')
  assert.equal(relativeUpdated(now - 5 * 60_000, now), '5m ago')
})
