import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCatalog, AgentModel, AgentSession, ChatItem } from '@cerebro/core'
import { ChatView } from '@/components/chat/chat-view'

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

const catalog = {
  capabilities: {
    claude: {
      resume: true,
      cancel: true,
      approvals: 'tools',
      questions: true,
      modelSelection: 'between-turns',
      fork: 'native',
      rewind: 'native'
    },
    codex: {
      resume: true,
      cancel: true,
      approvals: 'commands-and-files',
      questions: true,
      modelSelection: 'between-turns',
      fork: 'emulated',
      rewind: 'emulated'
    },
    pi: {
      resume: true,
      cancel: true,
      approvals: 'none',
      questions: true,
      modelSelection: 'between-turns',
      fork: 'emulated',
      rewind: 'native'
    }
  },
  models: [model],
  favorites: [],
  issues: {}
} as AgentCatalog

const row = (partial: Pick<ChatItem, 'id' | 'turnId' | 'kind' | 'text'>): ChatItem => partial

const items: ChatItem[] = [
  row({ id: 't1:u', turnId: 't1', kind: 'user', text: 'Plan it' }),
  row({ id: 't1:a', turnId: 't1', kind: 'text', text: 'Plan ready' }),
  row({ id: 't2:u', turnId: 't2', kind: 'user', text: 'Go' }),
  row({ id: 't2:a', turnId: 't2', kind: 'text', text: 'Sent the plan to the agent' }),
  row({ id: 't3:u', turnId: 't3', kind: 'user', text: 'What is the progress?' }),
  row({ id: 't3:a', turnId: 't3', kind: 'text', text: 'Still running' })
]

function session(extra: Partial<AgentSession> = {}): AgentSession {
  return {
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
    items,
    commands: [],
    ...extra
  }
}

describe('chat transcript window', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('asks for a larger window when the reader wants earlier messages', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const chatCommand = vi.fn(async (command: { itemLimit?: number }) =>
      command.itemLimit && command.itemLimit > 400
        ? { session: session(), sessions: [] }
        : { session: session({ items: items.slice(2) }), sessions: [], earlierItems: 2 }
    )
    window.cerebro = {
      chatCommand,
      agentCatalog: vi.fn(async () => catalog),
      agentSkills: vi.fn(async () => ({ skills: [] })),
      agentCommands: vi.fn(async () => ({ commands: [] })),
      listWorkspaceFiles: vi.fn(async () => []),
      chatAttachment: vi.fn()
    } as unknown as typeof window.cerebro
    render(
      <QueryClientProvider client={client}>
        <ChatView workspaceId={1} paneId={2} agentModelDefaults={{}} />
      </QueryClientProvider>
    )
    await screen.findByText('Still running')
    expect(screen.queryByText('Plan ready')).toBeNull()
    expect(chatCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'get', itemLimit: 400 })
    )
    fireEvent.click(screen.getByTestId('chat-show-earlier'))
    await screen.findByText('Plan ready')
    expect(chatCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'get', itemLimit: 800 })
    )
    await waitFor(() => expect(screen.queryByTestId('chat-show-earlier')).toBeNull())
  })
})
