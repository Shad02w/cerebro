import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workingLabel } from './working-label'

test('formats the running duration', () => {
  assert.equal(workingLabel(0), 'working for 0s')
  assert.equal(workingLabel(12), 'working for 12s')
  assert.equal(workingLabel(3.9), 'working for 3s')
})
