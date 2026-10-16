import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatSearchHit } from '@cerebro/core'
import type { Project, Workspace } from '../../../shared/types'
import { groupSessionsByProject, sessionWorkspaceLine } from './session-workspace-line'

function workspace(
  partial: Partial<Workspace> & Pick<Workspace, 'id' | 'kind' | 'branch'>
): Workspace {
  return {
    projectId: 1,
    repositoryId: 1,
    localPath: '/tmp/repo',
    status: 'todo',
    displayName: null,
    createdAt: '',
    pullRequest: null,
    ...partial
  }
}

test('palette workspace line uses the branch, the nested repo, or root', () => {
  const single = {
    name: 'cerebro',
    kind: 'directory' as const,
    repositories: [{ id: 1, name: 'cerebro' }]
  }
  assert.equal(
    sessionWorkspaceLine(single, {
      kind: 'default',
      branch: 'main',
      repositoryId: 1,
      localPath: ''
    }),
    'main'
  )
  assert.equal(
    sessionWorkspaceLine(single, {
      kind: 'worktree',
      branch: 'feat/palette',
      repositoryId: 1,
      localPath: ''
    }),
    'feat/palette'
  )

  const multi = {
    name: 'clients',
    kind: 'multi-root' as const,
    repositories: [
      { id: 2, name: 'backend' },
      { id: 3, name: 'frontend' }
    ]
  }
  assert.equal(
    sessionWorkspaceLine(multi, {
      kind: 'root',
      branch: '.',
      repositoryId: 2,
      localPath: '/clients'
    }),
    'root'
  )
  assert.equal(
    sessionWorkspaceLine(multi, {
      kind: 'default',
      branch: 'main',
      repositoryId: 2,
      localPath: '/clients/backend'
    }),
    'backend · main'
  )
  assert.equal(
    sessionWorkspaceLine(multi, {
      kind: 'default',
      branch: 'main',
      repositoryId: 3,
      localPath: '/clients/frontend'
    }),
    'frontend · main'
  )
})

test('sessions group by sidebar project order, Open then Closed', () => {
  const cerebro = {
    id: 1,
    name: 'cerebro',
    workspaces: [workspace({ id: 10, kind: 'default', branch: 'main' })]
  } as Project
  const clients = {
    id: 2,
    name: 'clients',
    workspaces: [
      workspace({ id: 20, kind: 'root', branch: '.' }),
      workspace({ id: 21, kind: 'default', branch: 'main', repositoryId: 2 })
    ]
  } as Project
  const hit = (
    partial: Partial<ChatSearchHit> & Pick<ChatSearchHit, 'sessionId' | 'workspaceId' | 'open'>
  ): ChatSearchHit => ({ title: partial.sessionId, ...partial }) as ChatSearchHit
  const groups = groupSessionsByProject(
    [cerebro, clients],
    [
      hit({ sessionId: 'closed-clients', workspaceId: 21, open: false }),
      hit({ sessionId: 'open-cerebro', workspaceId: 10, open: true }),
      hit({ sessionId: 'closed-cerebro', workspaceId: 10, open: false }),
      hit({ sessionId: 'open-root', workspaceId: 20, open: true })
    ]
  )
  assert.deepEqual(
    groups.map((group) => ({
      name: group.project.name,
      open: group.open.map((item) => item.sessionId),
      closed: group.closed.map((item) => item.sessionId)
    })),
    [
      { name: 'cerebro', open: ['open-cerebro'], closed: ['closed-cerebro'] },
      { name: 'clients', open: ['open-root'], closed: ['closed-clients'] }
    ]
  )
})
