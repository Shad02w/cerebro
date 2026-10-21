import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentCatalog,
  AgentModel,
  AgentSession,
  ChatActivityOverview,
  ChatAgentActivity,
  WorkspaceTab
} from '@cerebro/core'
import { ChatTabIcon } from '@/components/chat/chat-tab-icon'
import { ChatView } from '@/components/chat/chat-view'
import { queryClient, refreshChatQueries } from '@/lib/query-client'

const model: AgentModel = {
  key: 'test',
  instance: 'local',
  harness: 'codex',
  provider: 'test',
  id: 'test',
  label: 'Test',
  source: 'native',
  available: true,
  reasoning: []
}

const session: AgentSession = {
  version: 1,
  id: 'session',
  workspaceId: 1,
  repositoryId: 3,
  cwd: '/tmp',
  title: 'Chat',
  model,
  status: 'idle',
  generation: '',
  sequence: 1,
  updatedAt: 1,
  items: [{ id: 't1:a', turnId: 't1', kind: 'text', text: 'Latest reply' }],
  commands: []
}

function stubCerebro(extra: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const chatCommand = vi.fn(async () => ({ session, sessions: [] }))
  window.cerebro = {
    chatCommand,
    agentCatalog: vi.fn(
      async () =>
        ({
          capabilities: {},
          models: [model],
          favorites: [],
          issues: {}
        }) as unknown as AgentCatalog
    ),
    agentSkills: vi.fn(async () => ({ skills: [] })),
    listWorkspaceFiles: vi.fn(async () => []),
    chatAttachment: vi.fn(),
    ...extra
  } as unknown as typeof window.cerebro
  return chatCommand
}

const getCalls = (chatCommand: ReturnType<typeof vi.fn>): number =>
  chatCommand.mock.calls.filter(([command]) => command.action === 'get').length

describe('chat pane refresh', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => queryClient.clear())

  it('does not read a hidden pane transcript, then reads it once when shown', async () => {
    const chatCommand = stubCerebro()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = (visible: boolean): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <ChatView workspaceId={1} paneId={2} visible={visible} agentModelDefaults={{}} />
      </QueryClientProvider>
    )
    const { rerender } = render(view(false))
    await client.invalidateQueries({ queryKey: ['chat', 1] })
    expect(getCalls(chatCommand)).toBe(0)

    rerender(view(true))
    await screen.findByText('Latest reply')
    expect(getCalls(chatCommand)).toBe(1)

    rerender(view(false))
    await client.invalidateQueries({ queryKey: ['chat', 1] })
    expect(getCalls(chatCommand)).toBe(1)
    rerender(view(true))
    await waitFor(() => expect(getCalls(chatCommand)).toBe(2))
  })

  it('gives an in-flight pane read one trailing refetch instead of stacking requests', async () => {
    const releases: Array<() => void> = []
    const queryFn = vi.fn(
      () => new Promise<number>((resolve) => releases.push(() => resolve(releases.length)))
    )
    const observer = new QueryObserver(queryClient, {
      queryKey: ['chat', 1, 2],
      queryFn,
      staleTime: Infinity
    })
    const unsubscribe = observer.subscribe(() => {})
    expect(queryFn).toHaveBeenCalledTimes(1)

    for (let event = 0; event < 20; event++) refreshChatQueries(['chat', 1])
    expect(queryFn).toHaveBeenCalledTimes(1)

    releases[0]()
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    releases[1]()
    await waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'))
    expect(queryFn).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('shows a background tab agent status from the overview without reading its transcript', async () => {
    const overview: ChatActivityOverview = {
      workspaces: [
        {
          workspaceId: 1,
          agents: [
            {
              sessionId: 'session',
              harness: 'codex',
              status: 'running',
              paneId: 7,
              paneIds: [7]
            } as unknown as ChatAgentActivity
          ]
        }
      ]
    }
    const chatCommand = stubCerebro({ chatOverview: vi.fn(async () => overview) })
    const tab: WorkspaceTab = {
      id: 1,
      kind: 'chat',
      label: 'Agent',
      root: { type: 'pane', id: 7, kind: 'chat' },
      activePaneId: 7
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ChatTabIcon workspaceId={1} tab={tab} />
      </QueryClientProvider>
    )
    await screen.findByTestId('chat-tab-agent-icon')
    expect(document.querySelector('[data-chat-agent-status]')).toHaveAttribute(
      'data-chat-agent-status',
      'running'
    )
    expect(chatCommand).not.toHaveBeenCalled()
  })
})
