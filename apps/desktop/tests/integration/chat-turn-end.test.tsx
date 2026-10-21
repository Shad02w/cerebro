import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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

function renderChat(view: AgentSession): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  window.cerebro = {
    chatCommand: vi.fn(async () => ({ session: view, sessions: [] })),
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
}

describe('chat End of response', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('ends every idle turn when no work is running', async () => {
    renderChat(session())
    await screen.findByText('Still running')
    expect(screen.getAllByRole('separator', { name: 'End of response' })).toHaveLength(3)
  })

  it('holds End of response from the turn that resumed a running agent', async () => {
    renderChat(
      session({
        subagents: [
          { id: 'agent', title: 'Find feature path', status: 'running', createdAt: 1, turnId: 't2' }
        ]
      })
    )
    await screen.findByText('Still running')
    expect(screen.getAllByRole('separator', { name: 'End of response' })).toHaveLength(1)
    expect(screen.getAllByTestId('chat-turn-held')).toHaveLength(2)
  })

  it('gives no End of response to an agent finish that arrived while idle', async () => {
    const agent = {
      id: 'agent',
      title: 'Find feature path',
      status: 'completed' as const,
      createdAt: 1,
      durationMs: 3_518_000
    }
    renderChat(
      session({
        items: [
          ...items,
          {
            id: 'idle:agent:agent:1',
            turnId: 'idle',
            kind: 'notice',
            text: 'Agent "Find feature path" finished · 58m 38s',
            agent
          }
        ],
        subagents: [agent]
      })
    )
    await screen.findByText('Agent "Find feature path" finished · 58m 38s')
    expect(screen.getAllByRole('separator', { name: 'End of response' })).toHaveLength(3)
  })

  it('holds the turn whose shell is still running in the background', async () => {
    renderChat(
      session({
        items: [
          ...items.slice(0, 3),
          row({ id: 't2:bash', turnId: 't2', kind: 'tool', text: '' }),
          ...items.slice(3)
        ],
        background: [
          { id: 'shell', title: 'sleep 120', status: 'running', itemId: 'bash', startedAt: 1 }
        ]
      })
    )
    await screen.findByText('Still running')
    expect(screen.getAllByRole('separator', { name: 'End of response' })).toHaveLength(1)
  })
})
