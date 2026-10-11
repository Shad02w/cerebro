import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ClaudeTodoList, codexTodoSnapshot } from './todo'

const listId = 'session:chat-1:todo'

test('codex plan notification becomes one checklist snapshot', () => {
  const snapshot = codexTodoSnapshot('chat-1', 'thread-1', {
    threadId: 'thread-1',
    explanation: 'Connecting the adapters next.',
    plan: [
      { step: 'Inspect the workspace', status: 'completed' },
      { step: 'Connect the adapters', status: 'inProgress' },
      { step: 'Ship the list', status: 'pending' }
    ]
  })
  assert.deepEqual(snapshot, {
    kind: 'todo',
    listId,
    explanation: 'Connecting the adapters next.',
    items: [
      { id: '0', label: 'Inspect the workspace', status: 'completed' },
      { id: '1', label: 'Connect the adapters', status: 'in_progress' },
      { id: '2', label: 'Ship the list', status: 'pending' }
    ]
  })
})

test('codex ignores a plan for another thread and keeps explanation only when set', () => {
  assert.equal(
    codexTodoSnapshot('chat-1', 'thread-1', {
      threadId: 'thread-other',
      plan: [{ step: 'Do not keep', status: 'pending' }]
    }),
    undefined
  )
  assert.deepEqual(codexTodoSnapshot('chat-1', 'thread-1', { threadId: 'thread-1', plan: [] }), {
    kind: 'todo',
    listId,
    items: []
  })
})

test('claude task tools fold into one list and tool_use_result supplies the id', () => {
  const list = new ClaudeTodoList('chat-1')
  const created = list.input('toolu_create', 'TaskCreate', {
    subject: 'Inspect',
    active_form: 'Inspecting the workspace'
  })
  assert.deepEqual(created?.items, [
    {
      id: 'toolu_create',
      label: 'Inspect',
      status: 'pending',
      activeLabel: 'Inspecting the workspace'
    }
  ])
  const named = list.result('toolu_create', { task: { id: '1', subject: 'Inspect' } })
  assert.equal(named?.items[0]?.id, '1')
  assert.equal(named?.items[0]?.activeLabel, 'Inspecting the workspace')

  list.input('toolu_connect', 'TaskCreate', {
    subject: 'Connect',
    activeForm: 'Connecting adapters'
  })
  list.result('toolu_connect', { task: { id: '2', subject: 'Connect' } })
  const started = list.input('toolu_update', 'TaskUpdate', {
    taskId: '2',
    status: 'in_progress',
    activeForm: 'Connecting adapters'
  })
  assert.deepEqual(
    started?.items.map((item) => item.status),
    ['pending', 'in_progress']
  )

  list.input('toolu_ship', 'TaskCreate', { subject: 'Ship the list' })
  list.result('toolu_ship', { task: { id: '3', subject: 'Ship the list' } })
  const removed = list.input('toolu_delete', 'TaskUpdate', { task_id: '3', status: 'deleted' })
  assert.deepEqual(
    removed?.items.map((item) => item.id),
    ['1', '2']
  )

  const listed = list.result('toolu_list', {
    tasks: [
      { id: '2', subject: 'Connect', status: 'in_progress', blockedBy: [] },
      { id: '1', subject: 'Inspect', status: 'completed', blockedBy: [] }
    ]
  })
  assert.equal(listed?.listId, listId)
  assert.deepEqual(listed?.items, [
    { id: '2', label: 'Connect', status: 'in_progress', activeLabel: 'Connecting adapters' },
    { id: '1', label: 'Inspect', status: 'completed', activeLabel: 'Inspecting the workspace' }
  ])
})

test('claude TodoWrite replaces the checklist and an empty list clears it', () => {
  const list = new ClaudeTodoList('chat-1', [{ id: '1', label: 'Old', status: 'pending' }])
  const written = list.input('toolu_write', 'TodoWrite', {
    todos: [
      { content: 'Inspect', status: 'completed', activeForm: 'Inspecting' },
      { content: 'Connect', status: 'in_progress', activeForm: 'Connecting adapters' }
    ]
  })
  assert.deepEqual(written?.items, [
    { id: '0', label: 'Inspect', status: 'completed', activeLabel: 'Inspecting' },
    { id: '1', label: 'Connect', status: 'in_progress', activeLabel: 'Connecting adapters' }
  ])
  const confirmed = list.result('toolu_write', {
    oldTodos: [],
    newTodos: [{ content: 'Connect', status: 'completed', activeForm: 'Connecting adapters' }]
  })
  assert.deepEqual(confirmed?.items, [
    { id: '0', label: 'Connect', status: 'completed', activeLabel: 'Connecting adapters' }
  ])
  assert.deepEqual(list.input('toolu_clear', 'TodoWrite', { todos: [] })?.items, [])
})

test('claude ignores tools that are not the checklist', () => {
  const list = new ClaudeTodoList('chat-1')
  assert.equal(list.input('toolu_bash', 'Bash', { command: 'ls' }), undefined)
  assert.equal(list.result('toolu_bash', { stdout: 'ok' }), undefined)
  assert.deepEqual(list.input('toolu_list', 'TaskList', {}), undefined)
})
