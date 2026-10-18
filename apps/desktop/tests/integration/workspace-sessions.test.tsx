import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChatAgentActivity } from '@cerebro/core'
import { WorkspaceSessionList } from '@/components/workspace-sessions'

const parent: ChatAgentActivity = {
  sessionId: 'session',
  workspaceId: 1,
  repositoryId: null,
  harness: 'claude',
  status: 'running',
  title: 'Pi GUI search',
  modelLabel: 'Sonnet',
  preview: '',
  paneId: 1,
  paneIds: [1],
  subagents: [
    { id: 'live', title: 'Search blogs', status: 'running', durationMs: 5_000 },
    { id: 'starting', title: 'Draft plan', status: 'created' },
    { id: 'done', title: 'Search GitHub', status: 'completed', durationMs: 16_000 },
    { id: 'failed', title: 'Search talks', status: 'failed', startedAt: 0, finishedAt: 2_000 }
  ]
}

function renderList(): ReturnType<typeof vi.fn> {
  window.cerebro = {
    getLayout: vi.fn(async () => ({ epoch: 1, revision: 1, workspaces: {} }))
  } as unknown as typeof window.cerebro
  const onOpen = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <WorkspaceSessionList agents={[parent]} onOpenAgent={onOpen} />
    </QueryClientProvider>
  )
  return onOpen
}

describe('WorkspaceSessionList children', () => {
  it('indents live children whether or not the workspace row is selected', async () => {
    const user = userEvent.setup()
    const onOpen = renderList()
    expect(screen.getByTestId('workspace-agent-open')).toHaveAttribute(
      'data-agent-title',
      'Pi GUI search'
    )
    const rows = screen.getAllByTestId('workspace-subagent')
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['running', 'created'])
    expect(rows[0]).toHaveClass('pl-5')
    expect(rows[0]).toHaveAccessibleName('Search blogs, Running')
    expect(rows[0]).toHaveTextContent('5s')
    expect(rows[0].querySelector('[aria-label="Agent running"]')).not.toBeNull()
    expect(rows[1]).toHaveAccessibleName('Draft plan, Running')
    expect(rows[1]).not.toHaveTextContent('5s')
    await user.click(rows[0])
    expect(onOpen).toHaveBeenCalledWith(parent)
  })

  it('keeps settled children out of the sidebar', () => {
    renderList()
    expect(screen.queryByRole('button', { name: 'Search GitHub, Done' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Search talks, Failed' })).toBeNull()
    expect(screen.queryByText('Search GitHub')).toBeNull()
    expect(screen.queryByText('Search talks')).toBeNull()
  })
})
