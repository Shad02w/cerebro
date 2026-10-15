import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workingHeading } from './working-label'

test('formats the finished working heading', () => {
  assert.equal(workingHeading(4), 'Working for 4s')
  assert.equal(workingHeading(null), 'Working')
})
