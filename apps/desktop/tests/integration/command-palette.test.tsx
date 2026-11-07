import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSearchHit, ChatSearchQuery } from '@cerebro/core'
import type { Project, Workspace } from '@shared/types'
import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette, type PaletteRow } from '@/components/command-palette'
import { SidebarProvider } from '@/components/ui/sidebar'
import { KeybindProvider } from '@/keybinds'

function workspace(
  partial: Pick<Workspace, 'id' | 'projectId' | 'repositoryId' | 'kind' | 'branch' | 'localPath'> &
    Partial<Workspace>
): Workspace {
  return {
    status: 'todo',
    displayName: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    pullRequest: null,
    ...partial
  }
}

function project(id: number, name: string, workspaces: Workspace[]): Project {
  return {
    id,
    name,
    kind: 'clone',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    github: { owner: 'acme', repo: name },
    repositories: [
      {
        id,
        projectId: id,
        gitUrl: `https://github.com/acme/${name}.git`,
        name,
        localPath: `/tmp/${name}`,
        defaultBranch: 'main',
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    ],
    workspaces
  }
}

const cerebro = project(1, 'cerebro', [
  workspace({
    id: 11,
    projectId: 1,
    repositoryId: 1,
    kind: 'default',
    branch: 'main',
    localPath: '/tmp/cerebro'
  }),
  workspace({
    id: 12,
    projectId: 1,
    repositoryId: 1,
    kind: 'worktree',
    branch: 'command-palette',
    localPath: '/tmp/cerebro-palette'
  })
])
const tokens = project(2, 'palette-tokens', [
  workspace({
    id: 21,
    projectId: 2,
    repositoryId: 2,
    kind: 'default',
    branch: 'main',
    localPath: '/tmp/palette-tokens'
  })
])
const projects = [cerebro, tokens]

function hit(sessionId: string, workspaceId: number, open: boolean, title: string): ChatSearchHit {
  return {
    sessionId,
    workspaceId,
    repositoryId: null,
    harness: 'claude',
    status: 'idle',
    title,
    modelLabel: 'Opus',
    preview: '',
    paneId: null,
    paneIds: [],
    updatedAt: Date.now() - 60_000,
    snippet: '',
    open
  } as ChatSearchHit
}

const hits = [
  hit('open-1', 12, true, 'Build command palette'),
  hit('closed-1', 12, false, 'Spike palette matcher'),
  hit('closed-2', 11, false, 'Migrate session search')
]
let chatSearch: ReturnType<typeof vi.fn>

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
  chatSearch = vi.fn(async (query: ChatSearchQuery) => ({
    hits: hits.filter((item) => query.workspaceIds.includes(item.workspaceId)),
    total: hits.length
  }))
  window.cerebro = {
    chatOverview: async () => ({ workspaces: [] }),
    chatSearch,
    onMenuClose: () => () => {}
  } as unknown as typeof window.cerebro
})

afterEach(cleanup)

function renderPalette(
  onChoose: (row: PaletteRow) => void = vi.fn(),
  activeWorkspaceId = 12
): { onClose: () => void } {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client()}>
      <KeybindProvider overrides={null}>
        <CommandPalette
          open
          projects={projects}
          activeWorkspaceId={activeWorkspaceId}
          onChoose={onChoose}
          onClose={onClose}
        />
      </KeybindProvider>
    </QueryClientProvider>
  )
  return { onClose }
}

function groupOrder(): string[] {
  return screen
    .getAllByTestId(/^command-palette-group-/)
    .map((group) => group.dataset.testid?.replace('command-palette-group-', '') ?? '')
}

describe('command palette', () => {
  it('lists recent projects, workspaces, sessions and history in that order', async () => {
    renderPalette()
    await waitFor(() =>
      expect(groupOrder()).toEqual(['project', 'workspace', 'session', 'history'])
    )
    const history = screen.getByTestId('command-palette-group-history')
    const closed = within(history).getAllByTestId('command-palette-option')
    expect(closed.map((row) => row.dataset.rowType)).toEqual(['history', 'history'])
    expect(closed[0]).toHaveTextContent('Closed')
    expect(closed[0].querySelector('.truncate')?.className).toContain('text-amber-600')
    const open = within(screen.getByTestId('command-palette-group-session')).getByTestId(
      'command-palette-option'
    )
    expect(open).toHaveTextContent('Open')
    expect(open.querySelector('.truncate')?.className).not.toContain('text-amber')
  })

  it('filters every group by the query and opens the highlighted row with Enter', async () => {
    const onChoose = vi.fn()
    const user = userEvent.setup()
    const { onClose } = renderPalette(onChoose)
    const input = screen.getByTestId('command-palette-input')
    await user.type(input, 'palette')
    await waitFor(() =>
      expect(chatSearch).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'palette' }))
    )
    await waitFor(() =>
      expect(groupOrder()).toEqual(['project', 'workspace', 'session', 'history'])
    )
    const first = screen.getAllByTestId('command-palette-option')[0]
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(first).toHaveAttribute('data-row-key', 'project:2')
    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByTestId('command-palette-option')[1]).toHaveAttribute(
      'data-row-key',
      'workspace:21'
    )
    expect(screen.getAllByTestId('command-palette-option')[1]).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await user.keyboard('{Enter}')
    await waitFor(() => expect(onChoose).toHaveBeenCalledTimes(1))
    expect(onChoose.mock.calls[0][0]).toMatchObject({ type: 'workspace', key: 'workspace:21' })
    expect(onClose).toHaveBeenCalled()
  })

  it('cycles filters with Tab and scopes sessions to the selected workspace', async () => {
    const user = userEvent.setup()
    renderPalette()
    const input = screen.getByTestId('command-palette-input')
    await waitFor(() => expect(groupOrder()).toHaveLength(4))
    await user.click(input)
    await user.keyboard('{Tab}')
    expect(screen.getByTestId('command-palette-filter-project')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(groupOrder()).toEqual(['project'])
    await user.keyboard('{Shift>}{Tab}{Tab}{/Shift}')
    expect(screen.getByTestId('command-palette-filter-history')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(groupOrder()).toEqual(['history'])

    const scope = screen.getByTestId('command-palette-scope')
    expect(scope).toHaveTextContent('in cerebro / command-palette')
    await user.click(scope)
    await waitFor(() =>
      expect(chatSearch).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceIds: [12] }))
    )
    await waitFor(() =>
      expect(
        screen.getAllByTestId('command-palette-option').map((row) => row.dataset.rowKey)
      ).toEqual(['history:closed-1'])
    )
    expect(input).toHaveFocus()
  })
})

describe('sidebar search button', () => {
  function renderSidebar(
    onSelectWorkspace: (workspaceId: number) => void = vi.fn()
  ): (workspaceId: number) => void {
    render(
      <QueryClientProvider client={client()}>
        <KeybindProvider overrides={null}>
          <SidebarProvider>
            <AppSidebar
              mode="projects"
              projects={projects}
              activeWorkspaceId={21}
              settingsSection="general"
              onSelectWorkspace={onSelectWorkspace}
              onAddProject={vi.fn()}
              onAddWorkspace={vi.fn()}
              onRenameWorkspace={vi.fn(async () => {})}
              onRemoveProject={vi.fn(async () => {})}
              onRemoveWorkspace={vi.fn(async () => {})}
              onSetWorkspaceStatus={vi.fn()}
              sidebarGroupBy="project"
              onSidebarGroupBy={vi.fn()}
              onSelectSettingsSection={vi.fn()}
              onOpenSettings={vi.fn()}
              onBack={vi.fn()}
            />
          </SidebarProvider>
        </KeybindProvider>
      </QueryClientProvider>
    )
    return onSelectWorkspace
  }

  it('sits left of Group by and replaces the search field and History buttons', () => {
    renderSidebar()
    const search = screen.getByTestId('sidebar-search')
    const groupBy = screen.getByTestId('sidebar-group-by')
    expect(search.compareDocumentPosition(groupBy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByLabelText('Session history')).toBeNull()
  })

  it('expands and focuses a collapsed project picked in the palette', async () => {
    const user = userEvent.setup()
    renderSidebar()
    const row = screen.getByTestId('project-row-1')
    if (row.getAttribute('aria-expanded') === 'true') await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByTestId('sidebar-search'))
    await user.type(screen.getByTestId('command-palette-input'), 'cerebro')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull())
    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'))
    await waitFor(() => expect(row).toHaveFocus())
  })

  it('selects and focuses a workspace picked in the palette', async () => {
    const user = userEvent.setup()
    const onSelectWorkspace = renderSidebar()
    await user.click(screen.getByTestId('sidebar-search'))
    await user.type(screen.getByTestId('command-palette-input'), 'command-palette')
    await waitFor(() =>
      expect(screen.getAllByTestId('command-palette-option')[0]).toHaveAttribute(
        'data-row-key',
        'workspace:12'
      )
    )
    await user.keyboard('{Enter}')
    expect(onSelectWorkspace).toHaveBeenCalledWith(12)
    await waitFor(() => expect(screen.getByTestId('workspace-row-12')).toHaveFocus())
  })
})
