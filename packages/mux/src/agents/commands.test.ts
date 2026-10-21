import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { claudeCommands, piCommands } from './commands'

describe('harness command lists', () => {
  test('Claude keeps built-ins and custom commands, once each, without a leading slash', () => {
    const listed = claudeCommands([
      {
        name: 'compact',
        description: 'Clear history\n but keep a summary',
        argumentHint: '[instructions]',
        builtin: true
      },
      { name: '/review', description: 'Review the diff' },
      { name: 'review', description: 'duplicate' },
      { name: 'bad name' },
      { name: 'formatter:lint', description: 'Lint' },
      // Commands that switch the conversation belong to the app, by name or by alias.
      { name: 'clear', builtin: true },
      { name: 'wipe', aliases: ['reset'], builtin: true },
      { name: 'resume', builtin: true },
      { name: 'model', builtin: true }
    ])
    assert.deepEqual(
      listed.map((entry) => [entry.name, entry.source, entry.argumentHint]),
      [
        ['compact', 'builtin', '[instructions]'],
        ['formatter:lint', 'custom', ''],
        ['review', 'custom', '']
      ]
    )
    assert.equal(listed[0].description, 'Clear history but keep a summary')
  })

  test('Pi leaves skills to the skill picker and adds the built-ins it does not report', () => {
    const listed = piCommands({
      commands: [
        { name: 'skill:review', source: 'skill' },
        { name: 'fix-tests', description: 'Fix them', source: 'extension' },
        { name: 'compact', description: 'Extension compact', source: 'extension' }
      ]
    })
    assert.deepEqual(
      listed.map((entry) => [entry.name, entry.source]),
      [
        ['compact', 'custom'],
        ['export', 'builtin'],
        ['fix-tests', 'custom'],
        ['name', 'builtin']
      ]
    )
    assert.equal(listed[0].description, 'Extension compact')
  })
})
