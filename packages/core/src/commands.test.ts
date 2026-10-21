import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseSlashCommand } from './commands'

describe('parseSlashCommand', () => {
  test('reads a whole-message command and its arguments', () => {
    assert.deepEqual(parseSlashCommand('/compact'), { name: 'compact', args: '' })
    assert.deepEqual(parseSlashCommand('  /rename  My thread\nsecond line '), {
      name: 'rename',
      args: 'My thread\nsecond line'
    })
    assert.deepEqual(parseSlashCommand('/plugin:cmd go'), { name: 'plugin:cmd', args: 'go' })
  })
  test('leaves ordinary prompts alone', () => {
    assert.equal(parseSlashCommand('please /compact'), undefined)
    assert.equal(parseSlashCommand('/'), undefined)
    assert.equal(parseSlashCommand('/../etc'), undefined)
  })
})
