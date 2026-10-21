import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentCapabilities,
  AgentCatalog,
  AgentModel,
  AgentSession,
  ChatItem
} from '@cerebro/core'
import { ChatView } from '@/components/chat/chat-view'

const capabilities: AgentCapabilities = {
  resume: true,
  cancel: true,
  approvals: 'tools',
  questions: true,
  modelSelection: 'between-turns',
  imageInput: true,
  steering: true,
  fork: 'native',
  rewind: 'native'
}

function model(id: string, label: string): AgentModel {
  return {
    key: JSON.stringify(['claude', 'local', 'configured', id]),
    instance: 'local',
    harness: 'claude',
    provider: 'configured',
    id,
    label,
    source: 'native',
    available: true,
    reasoning: []
  }
}

const sonnet = model('sonnet', 'Sonnet 5.5')
const opus = model('opus', 'Opus 5.5')

const catalog = {
  capabilities: { claude: capabilities, codex: capabilities, pi: capabilities },
  models: [sonnet, opus],
  favorites: [],
  issues: {}
} as AgentCatalog

const items: ChatItem[] = [
  { id: 't1:u', turnId: 't1', kind: 'user', text: 'glyph the branch' },
  { id: 't1:a', turnId: 't1', kind: 'text', text: 'Done.' }
]

function session(extra: Partial<AgentSession> = {}): AgentSession {
  return {
    version: 1,
    id: 'session',
    workspaceId: 1,
    repositoryId: 3,
    cwd: '/tmp',
    title: 'Chat',
    model: sonnet,
    status: 'idle',
    generation: '',
    sequence: 1,
    updatedAt: 1,
    items,
    commands: [],
    ...extra
  }
}

function renderChat(view: AgentSession | null): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  window.cerebro = {
    chatCommand: vi.fn(async () => ({ session: view, sessions: [] })),
    agentCatalog: vi.fn(async () => catalog),
    agentSkills: vi.fn(async () => ({ skills: [] })),
    listWorkspaceFiles: vi.fn(async () => []),
    chatAttachment: vi.fn()
  } as unknown as typeof window.cerebro
  render(
    <QueryClientProvider client={client}>
      <ChatView workspaceId={1} paneId={2} agentModelDefaults={{}} />
    </QueryClientProvider>
  )
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: RegExp): Promise<void> {
  await user.click(await screen.findByTestId('chat-model-picker'))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe('model switch in the same agent', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('leaves the composer empty and announces the lost prompt cache', async () => {
    const user = userEvent.setup()
    renderChat(session())
    await screen.findByText('Done.')
    const composer = screen.getByRole('textbox', { name: 'Message agent' })
    expect(composer).toHaveAttribute('data-composer-text', '')

    await choose(user, /^Opus 5\.5/)

    expect(screen.getByTestId('chat-model-picker')).toHaveTextContent('Opus 5.5')
    expect(composer).toHaveAttribute('data-composer-text', '')
    expect(screen.getByTestId('chat-notice-toast')).toHaveTextContent(
      'Now using Opus 5.5. This conversation stays, but its prompt cache starts over'
    )
  })

  it('does not warn before a conversation exists', async () => {
    const user = userEvent.setup()
    renderChat(null)
    await choose(user, /^Opus 5\.5/)

    expect(screen.getByTestId('chat-model-picker')).toHaveTextContent('Opus 5.5')
    expect(screen.queryByTestId('chat-notice-toast')).not.toBeInTheDocument()
  })
})
