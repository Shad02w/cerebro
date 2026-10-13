import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMMAND_PREVIEW_LENGTH, commandInputDetail, commandRun } from './command-preview'

const tool = (patch: {
  title?: string
  input?: string
  text?: string
}): {
  kind: 'tool'
  title?: string
  input?: string
  text: string
} => ({ kind: 'tool', text: '', ...patch })

test('previews a long Bash command with a .... marker and keeps the command', () => {
  const command = `echo ${'hello '.repeat(40)}`
  const run = commandRun(
    tool({
      title: 'Bash',
      input: JSON.stringify({ command, description: 'Say hello' }),
      text: 'hello\n'
    })
  )
  assert.ok(run)
  assert.equal(run.shell, 'bash')
  assert.equal(run.command, command.replace(/\s+/g, ' ').trim())
  assert.ok(run.preview.startsWith('> bash echo hello'))
  assert.ok(run.preview.endsWith('....'))
  assert.ok(run.preview.length <= COMMAND_PREVIEW_LENGTH + '....'.length)
  assert.equal(run.preview.includes('hello\n'), false)
  assert.equal(run.preview.includes(command), false)
  assert.equal(
    commandInputDetail(JSON.stringify({ command, description: 'Say hello' }), run.command),
    '{\n  "description": "Say hello"\n}'
  )
})

test('shows a short command on one line without a marker or the output', () => {
  const run = commandRun(tool({ title: 'pwd', text: '/tmp\n' }))
  assert.deepEqual(run, { command: 'pwd', shell: 'bash', preview: '> bash pwd' })
})

test('reads a command out of a partial JSON input while it is still streaming', () => {
  const run = commandRun(
    tool({
      title: 'Bash',
      input: '{"command": "git status --short && echo still-streaming'
    })
  )
  assert.equal(run?.command, 'git status --short && echo still-streaming')
  assert.equal(run?.preview, '> bash git status --short && echo still-streaming')
})

test('leaves file tools collapsed to their name', () => {
  assert.equal(
    commandRun(tool({ title: 'Read', input: '{"file_path":"a.ts"}', text: 'src' })),
    null
  )
  assert.equal(commandRun(tool({ title: 'webSearch', text: 'results' })), null)
  assert.equal(commandRun({ kind: 'reasoning', text: 'thinking' }), null)
})
