import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Circle, CircleCheck, CircleDot, Eye } from 'lucide-react'
import type { Project } from '@shared/types'
import { WORKSPACE_STATUS_PRESENTATION, projectsBesidesNestedRepos } from './workspace-status'

test('Todo uses the sky status color and Done uses the neutral color', () => {
  assert.equal(WORKSPACE_STATUS_PRESENTATION.todo.Icon, Circle)
  assert.equal(WORKSPACE_STATUS_PRESENTATION.done.Icon, CircleCheck)
  assert.equal(WORKSPACE_STATUS_PRESENTATION.in_progress.Icon, CircleDot)
  assert.equal(WORKSPACE_STATUS_PRESENTATION.ready_to_review.Icon, Eye)

  assert.match(WORKSPACE_STATUS_PRESENTATION.todo.iconClassName, /text-sky-500/)
  assert.match(WORKSPACE_STATUS_PRESENTATION.todo.badgeClassName, /bg-sky-500\/15/)
  assert.match(WORKSPACE_STATUS_PRESENTATION.todo.headerClassName, /text-sky-700/)
  assert.doesNotMatch(WORKSPACE_STATUS_PRESENTATION.todo.headerClassName, /text-sidebar-foreground/)

  assert.match(WORKSPACE_STATUS_PRESENTATION.done.iconClassName, /text-sidebar-foreground\/70/)
  assert.match(WORKSPACE_STATUS_PRESENTATION.done.badgeClassName, /bg-sidebar-foreground\/10/)
  assert.match(WORKSPACE_STATUS_PRESENTATION.done.headerClassName, /text-sidebar-foreground\/80/)
  assert.doesNotMatch(WORKSPACE_STATUS_PRESENTATION.done.headerClassName, /text-sky-/)

  assert.match(WORKSPACE_STATUS_PRESENTATION.in_progress.iconClassName, /text-amber-500/)
  assert.match(WORKSPACE_STATUS_PRESENTATION.ready_to_review.iconClassName, /text-emerald-500/)
})

test('a checkout inside a directory workspace is not a separate sidebar project', () => {
  const folder = {
    id: 1,
    nestedRepos: [
      { name: 'frontend', branch: 'main', localPath: '/apps/frontend' },
      { name: 'backend', branch: 'develop', localPath: '/apps/backend/' }
    ],
    repositories: [{ localPath: '/apps' }],
    workspaces: [{ localPath: '/apps' }]
  }
  const frontend = {
    id: 2,
    repositories: [{ localPath: '/apps/frontend' }],
    workspaces: [{ localPath: '/apps/frontend' }]
  }
  const notes = {
    id: 3,
    repositories: [{ localPath: '/notes' }],
    workspaces: [{ localPath: '/notes' }, { localPath: '/notes-feature' }]
  }

  const visible = projectsBesidesNestedRepos([folder, frontend, notes] as Project[])
  assert.deepEqual(
    visible.map((project) => project.id),
    [1, 3]
  )
})
