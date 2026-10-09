import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AppNotification } from '@cerebro/core'
import { createResponseHandler } from './responses'

const base: AppNotification = {
  id: 'agent:s1',
  kind: 'blocked',
  title: 't',
  body: 'b',
  target: { workspaceId: 2, sessionId: 's1', paneId: 7 },
  request: { id: 'p1', kind: 'approval' }
}
function setup(): { handle: ReturnType<typeof createResponseHandler>; calls: unknown[][] } {
  const calls: unknown[][] = []
  const handle = createResponseHandler({
    revealWindow: () => void calls.push(['reveal']),
    muxCall: async (method, params) => void calls.push([method, params]),
    setActiveWorkspace: async (id) => void calls.push(['select', id]),
    focusWorkspaceInUi: (id) => void calls.push(['ui', id])
  })
  return { handle, calls }
}

test('allow and deny reply to the pending request without stealing focus', async () => {
  for (const actionId of ['allow', 'deny'] as const) {
    const { handle, calls } = setup()
    await handle({ type: 'action', notification: base, actionId })
    assert.deepEqual(calls, [
      [
        'chat.command',
        {
          action: 'reply',
          workspaceId: 2,
          paneId: 7,
          requestId: 'p1',
          allow: actionId === 'allow',
          answers: {}
        }
      ]
    ])
  }
})

test('open reveals the window and focuses the pane', async () => {
  const { handle, calls } = setup()
  await handle({ type: 'open', notification: base })
  assert.deepEqual(calls, [
    ['reveal'],
    ['layout.command', { target: 'pane', action: 'focus', workspaceId: 2, paneId: 7 }]
  ])
})

test('open without a pane selects the workspace instead', async () => {
  const { handle, calls } = setup()
  await handle({
    type: 'open',
    notification: { ...base, target: { ...base.target, paneId: null } }
  })
  assert.deepEqual(calls, [['reveal'], ['select', 2], ['ui', 2]])
})

test('an action on a notification without a pane falls back to opening the workspace', async () => {
  const { handle, calls } = setup()
  await handle({
    type: 'action',
    actionId: 'allow',
    notification: { ...base, target: { ...base.target, paneId: null } }
  })
  assert.deepEqual(calls, [['reveal'], ['select', 2], ['ui', 2]])
})
