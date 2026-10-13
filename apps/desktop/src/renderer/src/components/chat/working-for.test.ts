import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workingHeading } from './working-label'

test('formats the finished working heading', () => {
  assert.equal(workingHeading(4, 'Working on Read a.ts'), 'Working for 4s · Working on Read a.ts')
  assert.equal(workingHeading(null, 'Working on tools'), 'Working on tools')
})
