import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentStatusEvent, AppNotification } from '@cerebro/core'
import { NotificationHub, type NotificationChannel } from './hub'

function channel(
  name: string,
  available = true
): NotificationChannel & { sent: AppNotification[]; dismissed: string[] } {
  const sent: AppNotification[] = []
  const dismissed: string[] = []
  return {
    name,
    sent,
    dismissed,
    isAvailable: () => available,
    send: (n) => void sent.push(n),
    dismiss: (id) => void dismissed.push(id)
  }
}
const event = (over: Partial<AgentStatusEvent> = {}): AgentStatusEvent => ({
  kind: 'finished',
  workspaceId: 2,
  sessionId: 's1',
  paneId: 7,
  sessionTitle: 'Fix login',
  summary: 'Fixed the redirect.',
  at: 1,
  ...over
})
function setup(opts: { focused: boolean; visible?: boolean; systemAvailable?: boolean }): {
  hub: NotificationHub
  inApp: ReturnType<typeof channel>
  system: ReturnType<typeof channel>
  responses: unknown[]
} {
  const inApp = channel('in-app')
  const system = channel('system', opts.systemAvailable ?? true)
  const responses: unknown[] = []
  const hub = new NotificationHub({
    isAppFocused: () => opts.focused,
    isTargetVisible: () => opts.visible ?? false,
    describeWorkspace: () => ({ project: 'cerebro', workspace: 'notifications' }),
    inApp,
    system,
    onResponse: (r) => void responses.push(r)
  })
  return { hub, inApp, system, responses }
}

test('focused app shows the in-app channel; unfocused app shows the system channel', async () => {
  const focused = setup({ focused: true })
  await focused.hub.handle(event())
  assert.equal(focused.inApp.sent.length, 1)
  assert.equal(focused.system.sent.length, 0)

  const away = setup({ focused: false })
  await away.hub.handle(event())
  assert.equal(away.system.sent.length, 1)
  assert.equal(away.inApp.sent.length, 0)
})

test('stays silent when the user is already looking at the pane', async () => {
  const s = setup({ focused: true, visible: true })
  assert.equal(await s.hub.handle(event()), null)
  assert.equal(s.inApp.sent.length + s.system.sent.length, 0)
})

test('falls back to in-app when the system channel is unavailable', async () => {
  const s = setup({ focused: false, systemAvailable: false })
  await s.hub.handle(event())
  assert.equal(s.inApp.sent.length, 1)
})

test('blocked approvals carry the project title, a "needs you" body and allow/deny actions', async () => {
  const s = setup({ focused: false })
  const n = await s.hub.handle(
    event({ kind: 'blocked', summary: 'git push', request: { id: 'p1', kind: 'approval' } })
  )
  assert.equal(n?.title, 'cerebro / notifications')
  assert.equal(n?.body, 'Cerebro needs you: git push')
  assert.deepEqual(
    n?.actions?.map((a) => a.id),
    ['allow', 'deny']
  )
})

test('questions have no quick actions, they open the pane', async () => {
  const s = setup({ focused: false })
  const n = await s.hub.handle(
    event({ kind: 'blocked', summary: 'Which DB?', request: { id: 'q1', kind: 'question' } })
  )
  assert.equal(n?.actions, undefined)
})

test('a newer event replaces the session’s previous notification', async () => {
  const s = setup({ focused: false })
  await s.hub.handle(event({ kind: 'blocked', request: { id: 'p1', kind: 'approval' } }))
  await s.hub.handle(event())
  assert.deepEqual(s.system.dismissed, ['agent:s1'])
  assert.equal(s.system.sent.length, 2)
})

test('responding dismisses the notification and forwards the response', async () => {
  const s = setup({ focused: false })
  const n = (await s.hub.handle(event()))!
  await s.hub.respond({ type: 'open', notification: n })
  assert.deepEqual(s.system.dismissed, ['agent:s1'])
  assert.equal(s.responses.length, 1)
})
