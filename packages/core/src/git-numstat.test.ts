import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNumstatZ } from './git'

test('reads added and deleted lines, including a rename pair', () => {
  const stats = parseNumstatZ(
    ['3\t2\tREADME.md', '-\t-\timage.png', '0\t0\t', 'old.txt', 'new-name.txt'].join('\0') + '\0'
  )
  assert.deepEqual(stats.get('README.md'), { additions: 3, deletions: 2 })
  assert.deepEqual(stats.get('image.png'), { additions: 0, deletions: 0 })
  assert.deepEqual(stats.get('new-name.txt'), { additions: 0, deletions: 0 })
  assert.equal(stats.has('old.txt'), false)
})
