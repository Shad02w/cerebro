import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCatalog, AgentModel, AgentSession, ChatCommand, ChatItem } from '@cerebro/core'
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

const kept: ChatItem[] = [
  row({ id: 'u1', turnId: 't1', kind: 'user', text: 'First prompt' }),
  row({ id: 'a1', turnId: 't1', kind: 'text', text: 'First answer' })
]

function conversation(extra: Partial<AgentSession> = {}): AgentSession {
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
    items: kept,
    commands: [],
    ...extra
  }
}

const rewound = conversation({
  items: kept,
  rewind: {
    itemId: 'u2',
    turnId: 't2',
    tail: [
      row({ id: 'u2', turnId: 't2', kind: 'user', text: 'Second prompt' }),
      row({ id: 'a2', turnId: 't2', kind: 'text', text: 'Second answer' })
    ],
    displacedDraft: 'typed draft'
  }
})

const atStart = conversation({
  items: [],
  rewind: {
    itemId: 'u1',
    turnId: 't1',
    tail: kept,
    displacedDraft: ''
  }
})

function renderChat(initial: AgentSession): { commands: ChatCommand[] } {
  const commands: ChatCommand[] = []
  let view = initial
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  window.cerebro = {
    chatCommand: vi.fn(async (command: ChatCommand) => {
      commands.push(command)
      if (command.action === 'undo') view = conversation()
      else if (command.action === 'rewind') view = rewound
      return { session: view, sessions: [] }
    }),
    agentCatalog: vi.fn(async () => catalog),
    chatAttachment: vi.fn()
  } as unknown as typeof window.cerebro
  render(
    <QueryClientProvider client={client}>
      <ChatView workspaceId={1} paneId={2} agentModelDefaults={{}} />
    </QueryClientProvider>
  )
  return { commands }
}

describe('chat rewind', () => {
  beforeEach(() => {
    localStorage.clear()
    const rect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON: () => ({})
    } as DOMRect
    const list = {
      length: 1,
      item: () => rect,
      0: rect,
      [Symbol.iterator]: function* () {
        yield rect
      }
    } as unknown as DOMRectList
    Element.prototype.getClientRects = () => list
    Element.prototype.getBoundingClientRect = () => rect
    Range.prototype.getClientRects = () => list
    Range.prototype.getBoundingClientRect = () => rect
  })

  it('places Rewind to the left of Copy and edits the prompt until Escape', async () => {
    const user = userEvent.setup()
    renderChat(conversation())
    const message = await screen.findByTestId('chat-user-message')
    const rewind = within(message).getByTestId('chat-rewind')
    const copy = within(message).getByRole('button', { name: 'Copy message' })
    expect(rewind.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rewind).toHaveAttribute('aria-label', 'Rewind to before this prompt')

    await user.click(screen.getByTestId('chat-user-bubble'))
    expect(message).toHaveAttribute('data-editing', 'true')
    const editor = screen.getByRole('textbox', { name: 'Edit prompt' })
    expect(editor).toHaveTextContent('First prompt')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Edit prompt' })).toBeNull()
    expect(message).not.toHaveAttribute('data-editing')
  })

  it('shows one Undo line under the kept response and restores the displaced draft', async () => {
    const user = userEvent.setup()
    const { commands } = renderChat(rewound)
    const transcript = await screen.findByTestId('chat-transcript')
    const notice = await screen.findByTestId('chat-rewind-notice')
    expect(transcript).toContainElement(notice)
    expect(
      within(screen.getByTestId('chat-composer')).queryByTestId('chat-rewind-notice')
    ).toBeNull()
    expect(notice).toHaveTextContent('Rewound to this response. Changes were not restored.')
    const undo = within(notice).getByTestId('chat-rewind-undo')
    expect(undo).toHaveAttribute('data-variant', 'outline')
    expect(
      undo.compareDocumentPosition(within(notice).getByText(/Rewound to this response/)) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    const separator = screen.getByRole('separator', { name: 'End of response' })
    expect(
      separator.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(await screen.findByRole('textbox', { name: 'Message agent' })).toHaveTextContent(
      'Second prompt'
    )

    await user.click(screen.getByTestId('chat-rewind-undo'))
    await waitFor(() => {
      expect(commands.some((command) => command.action === 'undo')).toBe(true)
      expect(screen.queryByTestId('chat-rewind-notice')).toBeNull()
    })
    expect(screen.getByRole('textbox', { name: 'Message agent' })).toHaveTextContent('typed draft')
    expect(screen.getByTestId('chat-transcript')).toHaveTextContent('First answer')
  })

  it('uses the start copy when the first prompt is the cut', async () => {
    renderChat(atStart)
    expect(await screen.findByTestId('chat-rewind-notice')).toHaveTextContent(
      'Rewound to the start. Changes were not restored.'
    )
    expect(screen.queryByRole('separator', { name: 'End of response' })).toBeNull()
    expect(screen.getByTestId('chat-composer')).toHaveAttribute('data-dock', 'bottom')
  })
})
