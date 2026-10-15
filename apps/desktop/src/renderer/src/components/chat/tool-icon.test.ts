import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toolIconName } from './tool-icon'

test('matches shell, search, and web tools', () => {
  assert.equal(toolIconName('Bash'), 'shell')
  assert.equal(toolIconName('PowerShell'), 'shell')
  assert.equal(toolIconName('WebSearch'), 'web')
  assert.equal(toolIconName('web_fetch'), 'web')
  assert.equal(toolIconName('Grep'), 'grep')
  assert.equal(toolIconName('Glob'), 'glob')
})

test('matches file, task, and other harness tools', () => {
  assert.equal(toolIconName('Read'), 'read')
  assert.equal(toolIconName('Edit'), 'edit')
  assert.equal(toolIconName('MultiEdit'), 'edit')
  assert.equal(toolIconName('Write'), 'write')
  assert.equal(toolIconName('NotebookEdit'), 'notebook')
  assert.equal(toolIconName('TodoWrite'), 'todo')
  assert.equal(toolIconName('TaskCreate'), 'todo')
  assert.equal(toolIconName('Task'), 'agent')
  assert.equal(toolIconName('AskUserQuestion'), 'question')
  assert.equal(toolIconName('Skill'), 'skill')
  assert.equal(toolIconName('mcpToolCall'), 'mcp')
  assert.equal(toolIconName('imageView'), 'image')
  assert.equal(toolIconName('EnterPlanMode'), 'plan')
  assert.equal(toolIconName('ReadMcpResource'), 'mcp')
})

test('falls back to a generic tool icon', () => {
  assert.equal(toolIconName('dynamicToolCall'), 'tool')
  assert.equal(toolIconName(undefined), 'tool')
})
