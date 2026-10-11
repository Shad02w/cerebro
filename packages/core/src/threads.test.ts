import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatThread, ThreadProjectRef } from './threads'
import {
  filterThreadRows,
  groupThreadRows,
  sidebarThreadRows,
  threadDescription,
  threadLocation,
  threadRowStatus
} from './threads'

const attention = { kind: 'finished' as const, at: 1 }

test('thread status prefers a user request, then a running session, then workspace review', () => {
  assert.equal(
    threadRowStatus({
      sessionStatus: 'waiting',
      attention,
      workspaceStatus: 'done'
    }),
    'request user'
  )
  assert.equal(
    threadRowStatus({
      sessionStatus: 'running',
      attention,
      workspaceStatus: 'ready_to_review'
    }),
    'agent working'
  )
  assert.equal(
    threadRowStatus({
      sessionStatus: 'running',
      workspaceStatus: 'done'
    }),
    'agent working'
  )
  assert.equal(
    threadRowStatus({
      sessionStatus: 'idle',
      attention,
      workspaceStatus: 'ready_to_review'
    }),
    'waiting for review'
  )
  assert.equal(
    threadRowStatus({
      sessionStatus: 'interrupted',
      workspaceStatus: 'ready_to_review'
    }),
    'waiting for review'
  )
})

test('workspace done or a finished idle session is done; everything else is in progress', () => {
  assert.equal(
    threadRowStatus({
      sessionStatus: 'interrupted',
      workspaceStatus: 'done'
    }),
    'done'
  )
  assert.equal(
    threadRowStatus({
      sessionStatus: 'idle',
      attention,
      workspaceStatus: 'todo'
    }),
    'done'
  )
  assert.equal(
    threadRowStatus({
      sessionStatus: 'idle',
      attention,
      workspaceStatus: 'in_progress'
    }),
    'done'
  )
  assert.equal(threadRowStatus({ sessionStatus: 'failed', workspaceStatus: 'todo' }), 'in progress')
  assert.equal(
    threadRowStatus({ sessionStatus: 'interrupted', workspaceStatus: 'in_progress' }),
    'in progress'
  )
  assert.equal(threadRowStatus({ sessionStatus: 'idle', workspaceStatus: 'todo' }), 'in progress')
  assert.equal(
    threadRowStatus({ sessionStatus: 'idle', workspaceStatus: 'in_progress' }),
    'in progress'
  )
})

test('description uses the latest assistant line, then the first prompt', () => {
  assert.equal(
    threadDescription([
      { kind: 'user', text: 'first prompt' },
      { kind: 'text', text: 'earlier reply' },
      { kind: 'user', text: 'follow up' },
      { kind: 'reasoning', text: 'thinking' },
      { kind: 'text', text: '  latest\nreply  ' }
    ]),
    'latest reply'
  )
  assert.equal(
    threadDescription([
      { kind: 'user', text: '  Fix the\nhover  ' },
      { kind: 'text', text: '   ' },
      { kind: 'tool', text: 'ran tests' }
    ]),
    'Fix the hover'
  )
  assert.equal(threadDescription([{ kind: 'reasoning', text: 'only thoughts' }]), '')
})

test('description collapses whitespace and stays short', () => {
  const result = threadDescription([{ kind: 'text', text: `${'word '.repeat(80)}end` }])
  assert.ok(result.endsWith('…'))
  assert.ok(result.length <= 160)
  assert.equal(result.slice(0, -1), result.slice(0, -1).trimEnd())
  assert.equal(result.includes('  '), false)
})

test('location names the project and branch, and the nested repo on a multi-root child', () => {
  assert.equal(
    threadLocation({ projectName: 'cerebro', branch: 'feature/panes' }),
    'cerebro / feature/panes'
  )
  assert.equal(
    threadLocation({ projectName: 'suite', branch: 'main', nestedRepo: 'api' }),
    'suite / api / main'
  )
  assert.equal(threadLocation({ projectName: 'notes', branch: '.' }), 'notes')
})

const projects: ThreadProjectRef[] = [
  {
    name: 'cerebro',
    kind: 'clone',
    repositories: [{ id: 1, name: 'cerebro' }],
    workspaces: [
      {
        id: 10,
        kind: 'default',
        branch: 'main',
        status: 'todo',
        repositoryId: 1
      },
      {
        id: 11,
        kind: 'worktree',
        branch: 'feature/panes',
        status: 'ready_to_review',
        repositoryId: 1
      }
    ]
  },
  {
    name: 'suite',
    kind: 'multi-root',
    repositories: [
      { id: 2, name: 'api' },
      { id: 3, name: 'web' }
    ],
    workspaces: [
      { id: 20, kind: 'root', branch: '.', status: 'done', repositoryId: 2 },
      { id: 21, kind: 'default', branch: 'main', status: 'todo', repositoryId: 2 },
      { id: 22, kind: 'default', branch: 'main', status: 'in_progress', repositoryId: 3 }
    ]
  }
]

function thread(partial: Partial<ChatThread> & Pick<ChatThread, 'id' | 'workspaceId'>): ChatThread {
  return {
    repositoryId: null,
    title: partial.id,
    harness: 'codex',
    status: 'idle',
    updatedAt: 1,
    description: '',
    paneId: null,
    ...partial
  }
}

test('sidebar rows map project, nested repo, title, stored description, and status', () => {
  const rows = sidebarThreadRows(projects, [
    thread({
      id: 'running',
      workspaceId: 21,
      repositoryId: 2,
      title: '  Check the API  ',
      status: 'running',
      description: 'first prompt only',
      paneId: 4,
      updatedAt: 20
    }),
    thread({
      id: 'review',
      workspaceId: 11,
      title: 'Fix the hover',
      status: 'idle',
      attention,
      description: '**Adapter connected.**\n\nShipped.',
      updatedAt: 30
    }),
    thread({
      id: 'waiting',
      workspaceId: 10,
      title: 'Need a color',
      status: 'waiting',
      description: 'Need a color',
      updatedAt: 40
    }),
    thread({
      id: 'done-root',
      workspaceId: 20,
      title: '',
      status: 'interrupted',
      description: '',
      updatedAt: 5
    }),
    thread({
      id: 'idle-web',
      workspaceId: 22,
      title: 'Draft the page',
      status: 'idle',
      description: 'Draft the page',
      updatedAt: 15
    }),
    thread({ id: 'missing', workspaceId: 99, title: 'Gone' })
  ])
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
  assert.equal(byId.missing, undefined)
  assert.deepEqual(
    {
      location: byId.running.location,
      title: byId.running.title,
      description: byId.running.description,
      status: byId.running.status,
      open: byId.running.open
    },
    {
      location: 'suite / api / main',
      title: 'Check the API',
      description: 'first prompt only',
      status: 'agent working',
      open: true
    }
  )
  assert.equal(byId.review.location, 'cerebro / feature/panes')
  assert.equal(byId.review.description, '**Adapter connected.** Shipped.')
  assert.equal(byId.review.status, 'waiting for review')
  assert.equal(byId.review.open, false)
  assert.equal(byId.waiting.status, 'request user')
  assert.equal(byId.waiting.location, 'cerebro / main')
  assert.equal(byId['done-root'].location, 'suite / root')
  assert.equal(byId['done-root'].title, 'Untitled thread')
  assert.equal(byId['done-root'].status, 'done')
  assert.equal(byId['idle-web'].location, 'suite / web / main')
  assert.equal(byId['idle-web'].status, 'in progress')

  assert.deepEqual(
    groupThreadRows(rows).map((group) => [group.status, group.rows.map((row) => row.id)]),
    [
      ['request user', ['waiting']],
      ['agent working', ['running']],
      ['waiting for review', ['review']],
      ['in progress', ['idle-web']],
      ['done', ['done-root']]
    ]
  )
})

test('thread search matches location, title, description, and status', () => {
  const rows = sidebarThreadRows(projects, [
    thread({
      id: 'api',
      workspaceId: 21,
      title: 'Check the API',
      description: 'Look at routes',
      status: 'running'
    })
  ])
  assert.equal(filterThreadRows(rows, '  API  ').length, 1)
  assert.equal(filterThreadRows(rows, 'routes').length, 1)
  assert.equal(filterThreadRows(rows, 'agent working').length, 1)
  assert.equal(filterThreadRows(rows, 'ledger').length, 0)
  assert.equal(filterThreadRows(rows, '   ').length, 1)
})
