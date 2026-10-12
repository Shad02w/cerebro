import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutState, ThreadRow } from '@cerebro/core'
import { queryClient } from '@/lib/query-client'
import { openSavedThread } from '@/lib/thread-open'

const closed: ThreadRow = {
  id: 'session-1',
  workspaceId: 4,
  repositoryId: 2,
  paneId: null,
  harness: 'codex',
  location: 'cerebro / main',
  title: 'Fix the sidebar hover',
  description: '',
  status: 'done',
  updatedAt: 1,
  open: false
}

type Call = { kind: 'layout' | 'chat'; command: Record<string, unknown> }

function install(layout: LayoutState, activePaneId = 12): Call[] {
  const calls: Call[] = []
  queryClient.clear()
  window.cerebro = {
    getLayout: vi.fn(async () => layout),
    layoutCommand: vi.fn(async (command: Record<string, unknown>) => {
      calls.push({ kind: 'layout', command })
      return {
        state: { ...layout, revision: layout.revision + calls.length },
        result: { activePaneId }
      }
    }),
    chatCommand: vi.fn(async (command: Record<string, unknown>) => {
      calls.push({ kind: 'chat', command })
    })
  } as unknown as Window['cerebro']
  return calls
}

function chatLayout(repositoryId: number | null): LayoutState {
  return {
    revision: 1,
    workspaces: {
      4: {
        activeTabId: 1,
        nextLabel: 2,
        tabs: [
          {
            id: 1,
            kind: 'chat',
            label: 'Agent',
            activePaneId: 7,
            root: { type: 'pane', id: 7, kind: 'chat', repositoryId }
          }
        ]
      }
    }
  }
}

describe('openSavedThread', () => {
  beforeEach(() => {
    queryClient.clear()
  })

  it('focuses the pane that already shows the session', async () => {
    const calls = install({ revision: 1, workspaces: {} })
    await openSavedThread({ ...closed, paneId: 7, open: true })
    expect(calls).toEqual([
      {
        kind: 'layout',
        command: expect.objectContaining({
          target: 'pane',
          action: 'focus',
          workspaceId: 4,
          paneId: 7
        })
      }
    ])
  })

  it('reopens a closed session on a new chat pane in that workspace', async () => {
    const calls = install({ revision: 1, workspaces: {} }, 12)
    await openSavedThread(closed)
    expect(calls[0]?.command).toMatchObject({
      target: 'tab',
      action: 'create',
      kind: 'chat',
      workspaceId: 4,
      focus: true,
      repositoryId: 2
    })
    expect(calls[1]?.command).toMatchObject({
      action: 'open',
      workspaceId: 4,
      paneId: 12,
      sessionId: 'session-1'
    })
  })

  it('reopens a closed session in the active chat pane of the same repository', async () => {
    const calls = install(chatLayout(2))
    await openSavedThread(closed)
    expect(calls.map((call) => call.kind)).toEqual(['chat'])
    expect(calls[0]?.command).toMatchObject({
      action: 'open',
      workspaceId: 4,
      paneId: 7,
      sessionId: 'session-1'
    })
  })
})
