import assert from 'node:assert/strict'
import { test } from 'node:test'
import { searchFiles } from './file-search'

const files = ['README.md', 'src/app.ts', 'src/util/helper.ts', 'app/notes.ts', 'src/apply.ts']

test('an empty file query lists shallower paths first', () => {
  assert.deepEqual(searchFiles(files, ''), [
    'README.md',
    'app/notes.ts',
    'src/app.ts',
    'src/apply.ts',
    'src/util/helper.ts'
  ])
})

test('file search prefers the file name, then a fuzzy subsequence', () => {
  assert.deepEqual(searchFiles(files, 'app'), ['src/app.ts', 'src/apply.ts', 'app/notes.ts'])
  assert.equal(searchFiles(files, 'appts')[0], 'src/app.ts')
  assert.deepEqual(searchFiles(files, 'readme'), ['README.md'])
  assert.deepEqual(searchFiles(files, 'zzz'), [])
})
