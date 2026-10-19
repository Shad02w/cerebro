import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentActivityStatus } from '@cerebro/core'

const finished = { status: 'idle' as const, attention: { kind: 'finished' as const, at: 1 } }

test('a finished parent stays running in the UI while a child or background job is live', () => {
  assert.equal(agentActivityStatus(finished), 'finished')
  assert.equal(agentActivityStatus({ ...finished, subagents: [{ status: 'running' }] }), 'running')
  assert.equal(agentActivityStatus({ ...finished, subagents: [{ status: 'created' }] }), 'running')
  assert.equal(agentActivityStatus({ ...finished, background: [{ status: 'running' }] }), 'running')
  assert.equal(
    agentActivityStatus({ ...finished, subagents: [{ status: 'completed' }] }),
    'finished'
  )
  assert.equal(
    agentActivityStatus({ status: 'waiting', subagents: [{ status: 'running' }] }),
    'waiting'
  )
  assert.equal(
    agentActivityStatus({ status: 'failed', background: [{ status: 'running' }] }),
    'failed'
  )
  assert.equal(
    agentActivityStatus({ status: 'interrupted', subagents: [{ status: 'running' }] }),
    'interrupted'
  )
})
