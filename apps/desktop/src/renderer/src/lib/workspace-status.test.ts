import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Circle, CircleCheck, CircleDot, Eye } from 'lucide-react'
import { WORKSPACE_STATUS_PRESENTATION } from './workspace-status'

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
