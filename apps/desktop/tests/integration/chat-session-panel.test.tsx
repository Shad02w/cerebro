import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentCatalog,
  AgentModel,
  AgentSession,
  AgentSubagent,
  ChatCommand,
  WorkspaceChanges
} from '@cerebro/core'
import { ChatSessionPanel } from '@/components/chat/chat-session-panel'
import { ChatView } from '@/components/chat/chat-view'

const wide = '@min-[56rem]/chat'

function badgeCounts(root: HTMLElement): string[][] {
  return within(root)
    .getAllByTestId('chat-session-badge')
    .map((badge) => [badge.getAttribute('data-section') ?? '', badge.textContent ?? ''])
}

const model: AgentModel = {
  key: 'test',
  instance: 'local',
  harness: 'claude',
  provider: 'test',
  id: 'test',
  label: 'Test',
  source: 'native',
  available: true,
  reasoning: []
}

const child = (
  patch: Partial<AgentSubagent> & Pick<AgentSubagent, 'id' | 'status'>
): AgentSubagent => ({
  title: '',
  createdAt: 0,
  ...patch
})

const session = (extra: Partial<AgentSession> = {}): AgentSession =>
  ({
    id: 'session',
    title: '',
    model,
    items: [],
    ...extra
  }) as AgentSession

const filled = session({
  todo: {
    kind: 'todo',
    listId: 'session:chat:todo',
    items: [
      { id: '1', label: 'Inspect', status: 'completed' },
      { id: '2', label: 'Connect', status: 'in_progress', activeLabel: 'Connecting adapters' }
    ]
  },
  background: [{ id: 'server', title: 'Delayed pwd', status: 'running', startedAt: 1 }],
  subagents: [
    child({
      id: 'review',
      status: 'completed',
      title: 'Review the diff',
      startedAt: 0,
      finishedAt: 5_000,
      model: 'sonnet',
      effort: 'high',
      tokens: { input: 12_104, output: 6_316, total: 18_420 }
    })
  ]
})

const emptyChanges = { workspaceId: 1, groups: [] } satisfies WorkspaceChanges

function renderPanel(
  session: AgentSession | null,
  changes: WorkspaceChanges = emptyChanges
): ReturnType<typeof render> {
  window.cerebro = {
    listWorkspaceChanges: vi.fn(async () => changes)
  } as unknown as typeof window.cerebro
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ChatSessionPanel session={session} workspaceId={1} />
    </QueryClientProvider>
  )
}

describe('ChatSessionPanel', () => {
  it('stacks tasks, background jobs, and agents together', async () => {
    const user = userEvent.setup()
    renderPanel(filled)
    const panel = screen.getByRole('complementary', { name: 'Session status' })
    expect(panel).toHaveAttribute('data-testid', 'chat-session-panel')
    expect(panel).toHaveAttribute('data-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Expand session status' }))
    expect(panel).toHaveAttribute('data-expanded', 'true')
    expect(panel.className).toContain('absolute')
    expect(panel.className).toContain('hidden')
    expect(panel.className).toContain(`${wide}:flex`)
    expect(panel.className).not.toMatch(/(?:^|\s)(?:sm|md|lg|xl|2xl):/)
    expect(within(panel).queryByRole('tab')).toBeNull()
    expect(within(panel).queryByRole('tablist')).toBeNull()

    const tasks = screen.getByTestId('chat-session-panel-tasks')
    const background = screen.getByTestId('chat-session-panel-background')
    const agents = screen.getByTestId('chat-session-panel-agents')
    expect(
      tasks.compareDocumentPosition(background) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      background.compareDocumentPosition(agents) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    const sessionInset = screen.getByText('Session').parentElement
    expect(sessionInset).toHaveClass('px-2')
    for (const section of [tasks, background, agents]) {
      expect(section.className).not.toMatch(/(?:^|\s)px-/)
      expect(within(section).getByRole('heading').parentElement).toHaveClass('px-2')
    }
    expect(within(tasks).getByRole('list', { name: 'Tasks' })).toBeInTheDocument()
    expect(within(tasks).getByText('Inspect')).toHaveClass('line-through')
    expect(within(tasks).getByText('Connect')).toBeInTheDocument()
    expect(within(background).getByRole('heading', { name: 'Background' })).toBeInTheDocument()
    expect(within(background).getByRole('list', { name: 'Background jobs' })).toHaveTextContent(
      'Delayed pwd'
    )
    expect(within(agents).getByRole('heading', { name: 'Agents' })).toBeInTheDocument()
    expect(badgeCounts(panel)).toEqual([
      ['tasks', '2'],
      ['background', '1'],
      ['agents', '1']
    ])
    for (const badge of within(panel).getAllByTestId('chat-session-badge')) {
      expect(badge.className).toContain('bg-[var(--sidebar-selected)]')
      expect(badge.className).not.toMatch(/bg-(?:teal|red|blue|green|orange)-|bg-\[#/)
    }
    const agent = within(agents).getByTestId('chat-subagent')
    expect(agent).toHaveAttribute('data-status', 'completed')
    expect(agent).toHaveTextContent('Review the diff')
    expect(agent).toHaveTextContent('sonnet · high')
    expect(agent).toHaveTextContent('5s')
    expect(agent).toHaveTextContent('18.4k (12.1k in, 6.3k out)')
  })

  it('omits empty sections and renders nothing when the session has no status', async () => {
    const user = userEvent.setup()
    const { container, rerender } = renderPanel(session())
    expect(container).toBeEmptyDOMElement()
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ChatSessionPanel
          session={session({
            background: [{ id: 'server', title: 'nr dev', status: 'running', startedAt: 1 }]
          })}
          workspaceId={1}
        />
      </QueryClientProvider>
    )
    await user.click(screen.getByRole('button', { name: 'Expand session status' }))
    expect(screen.getByTestId('chat-session-panel-background')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-session-panel-tasks')).toBeNull()
    expect(screen.queryByTestId('chat-session-panel-agents')).toBeNull()
    expect(badgeCounts(screen.getByTestId('chat-session-panel'))).toEqual([['background', '1']])
    expect(screen.queryByTestId('chat-session-panel-changes')).toBeNull()
  })

  it('sums nested repositories into one Changes section', async () => {
    const user = userEvent.setup()
    renderPanel(filled, {
      workspaceId: 1,
      groups: [
        {
          repositoryId: 10,
          repositoryName: 'api',
          workspaceId: 2,
          files: [
            { path: 'src/a.ts', oldPath: null, status: 'modified', additions: 10, deletions: 2 },
            { path: 'src/b.ts', oldPath: null, status: 'added', additions: 1, deletions: 0 }
          ]
        },
        {
          repositoryId: 11,
          repositoryName: 'web',
          workspaceId: 3,
          files: [
            { path: 'app.tsx', oldPath: null, status: 'untracked', additions: 4, deletions: 3 }
          ]
        },
        {
          repositoryId: 12,
          repositoryName: 'docs',
          workspaceId: 4,
          files: []
        }
      ]
    })
    await user.click(screen.getByRole('button', { name: 'Expand session status' }))
    const changes = await screen.findByTestId('chat-session-panel-changes')
    expect(changes.className).not.toMatch(/(?:^|\s)px-/)
    const changesHeading = within(changes).getByRole('heading', { name: 'Changes' })
    expect(changesHeading.parentElement).toHaveClass('px-2')
    expect(changesHeading.parentElement?.className).toBe(
      within(screen.getByTestId('chat-session-panel-tasks')).getByRole('heading').parentElement
        ?.className
    )
    const stat = within(changes).getByTestId('chat-diff-stat')
    expect(stat).toHaveTextContent('+15 -5')
    expect(stat).toHaveAttribute('data-additions', '15')
    expect(stat).toHaveAttribute('data-deletions', '5')
    expect(within(stat).getByText('+15', { exact: true })).toHaveClass('text-green-500')
    expect(within(stat).getByText('-5', { exact: true })).toHaveClass('text-red-500')
    expect(within(changes).queryByTestId('chat-session-badge')).toBeNull()
    expect(screen.getAllByTestId('chat-diff-stat')).toHaveLength(1)
    expect(screen.getByTestId('chat-session-panel-tasks')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse session status' }))
    const rail = screen.getByTestId('chat-session-panel-rail')
    expect(rail.className).toContain('w-8')
    expect(rail.className).toContain('overflow-visible')
    expect(rail.className).not.toContain('w-max')
    const changesButton = within(rail).getByRole('button', { name: '+15 -5' })
    expect(changesButton.className).not.toContain('w-auto')
    expect(changesButton.className).toContain('max-w-8')
    const expandButton = within(rail).getByRole('button', { name: 'Expand session status' })
    expect(changesButton.className).toBe(expandButton.className)
    const mark = within(changesButton).getByTestId('chat-diff-stat')
    expect(mark.className).toContain('absolute')
    expect(mark).not.toHaveTextContent('+')
    expect(mark).toHaveAttribute('data-additions', '15')
    expect(mark).toHaveAttribute('data-deletions', '5')
    expect(mark.className).toContain('bg-green-500')
  })

  it('starts collapsed and expands back to every section', async () => {
    const user = userEvent.setup()
    renderPanel(filled)
    const rail = screen.getByTestId('chat-session-panel-rail')
    expect(rail.className).toContain('flex-col')
    expect(screen.queryByTestId('chat-session-panel-tasks')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(
      within(rail)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Expand session status', '2 tasks', '1 background job', '1 agent'])
    expect(badgeCounts(rail)).toEqual([
      ['tasks', '2'],
      ['background', '1'],
      ['agents', '1']
    ])
    expect(
      within(rail)
        .getByRole('button', { name: 'Expand session status' })
        .querySelector('[data-testid="chat-session-badge"]')
    ).toBeNull()
    await user.click(within(rail).getByRole('button', { name: 'Expand session status' }))
    expect(screen.getByTestId('chat-session-panel')).toHaveAttribute('data-expanded', 'true')
    expect(screen.getByTestId('chat-session-panel-tasks')).toBeInTheDocument()
    expect(screen.getByTestId('chat-session-panel-background')).toBeInTheDocument()
    expect(screen.getByTestId('chat-session-panel-agents')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-session-panel-rail')).toBeNull()
  })
})

const catalog = {
  capabilities: {},
  models: [model],
  favorites: [],
  issues: {}
} as AgentCatalog

describe('chat session layout', () => {
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

  it('floats the panel over a wide pane and hides the section bar when the pane is narrow', async () => {
    window.cerebro = {
      chatCommand: vi.fn(async (command: ChatCommand) => {
        if (command.action === 'get') return { session: filled, sessions: [] }
        return { session: filled, sessions: [] }
      }),
      agentCatalog: vi.fn(async () => catalog),
      agentSkills: vi.fn(async () => ({ skills: [] })),
      listWorkspaceFiles: vi.fn(async () => []),
      listWorkspaceChanges: vi.fn(async () => emptyChanges),
      layoutCommand: vi.fn(async () => ({ state: null })),
      chatAttachment: vi.fn()
    } as unknown as typeof window.cerebro
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ChatView workspaceId={1} paneId={2} agentModelDefaults={{}} />
      </QueryClientProvider>
    )

    const view = await screen.findByTestId('chat-view')
    expect(view.className).toContain('@container/chat')
    expect(view.className).not.toMatch(/(?:^|\s)(?:sm|md|lg|xl|2xl):/)

    const slot = await screen.findByTestId('chat-session-chips-slot')
    expect(slot.className).toContain('@max-[56rem]/chat:hidden')
    expect(slot.className).toContain(`${wide}:hidden`)
    expect(slot.className).not.toContain('min-[56rem]:')
    expect(slot.className).not.toContain('max-[56rem]:')
    const chips = within(slot).getByRole('toolbar', { name: 'Session status' })
    expect(
      within(chips)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['2 tasks', '1 background job', '1 agent'])

    const panel = screen.getByTestId('chat-session-panel')
    const composer = screen.getByTestId('chat-composer')
    const transcript = screen.getByTestId('chat-transcript')
    expect(composer.contains(panel)).toBe(false)
    expect(panel.className).toContain('absolute')
    expect(transcript.parentElement?.contains(panel)).toBe(true)
    expect(panel).toHaveAttribute('data-expanded', 'false')
    expect(within(panel).getByTestId('chat-session-panel-rail')).toBeInTheDocument()
    expect(within(panel).queryByRole('tab')).toBeNull()
  })
})
