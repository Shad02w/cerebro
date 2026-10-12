import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ThreadRow } from '@cerebro/core'
import { BranchSections, SectionHitList } from '@/components/branch-sections'

const hour = 60 * 60 * 1000

function row(partial: Partial<ThreadRow> & Pick<ThreadRow, 'id' | 'title'>): ThreadRow {
  return {
    workspaceId: 4,
    repositoryId: 2,
    paneId: null,
    harness: 'codex',
    location: 'cerebro / main',
    description: '',
    status: 'done',
    updatedAt: Date.now() - 2 * hour,
    open: false,
    ...partial
  }
}

const closed = row({ id: 'closed', title: 'Fix the sidebar hover' })
const open = row({
  id: 'open',
  title: 'Review the pane split',
  paneId: 8,
  open: true,
  updatedAt: Date.now()
})
const elsewhere = row({ id: 'other', workspaceId: 9, title: 'Fix the sidebar hover' })

describe('branch section search', () => {
  it('filters one branch and reopens a closed section or focuses an open one', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <BranchSections
        workspaceId={4}
        branch="main"
        rows={[closed, open, elsewhere]}
        onOpen={onOpen}
      />
    )

    await user.click(screen.getByTestId('branch-sections-4'))
    expect(screen.getByText('Sections on main')).toBeInTheDocument()
    expect(screen.getByTestId('branch-section-closed')).toHaveTextContent('Closed')
    expect(screen.getByTestId('branch-section-open')).toHaveTextContent('Open')
    expect(screen.queryByTestId('branch-section-other')).toBeNull()

    await user.type(screen.getByTestId('branch-sections-search-4'), 'hover')
    expect(screen.getByTestId('branch-section-closed')).toBeInTheDocument()
    expect(screen.queryByTestId('branch-section-open')).toBeNull()

    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'closed', paneId: null }))
  })

  it('focuses an open section from the branch list', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <BranchSections
        workspaceId={4}
        branch="main"
        rows={[closed, open, elsewhere]}
        onOpen={onOpen}
      />
    )
    await user.click(screen.getByTestId('branch-sections-4'))
    await user.click(screen.getByTestId('branch-section-open'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'open', paneId: 8 }))
  })

  it('says when the branch has no sections', async () => {
    const user = userEvent.setup()
    render(<BranchSections workspaceId={4} branch="main" rows={[]} onOpen={vi.fn()} />)
    await user.click(screen.getByTestId('branch-sections-4'))
    expect(screen.getByText('No earlier sections on this branch.')).toBeInTheDocument()
  })
})

describe('status section hits', () => {
  it('keeps a closed hit under its workspace and reopens it', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <div>
        <SectionHitList workspaceId={4} rows={[closed]} onOpen={onOpen} />
        <SectionHitList workspaceId={9} rows={[elsewhere]} onOpen={onOpen} />
      </div>
    )
    const hit = screen.getByTestId('status-section-closed')
    expect(hit).toHaveTextContent('Fix the sidebar hover')
    expect(hit).toHaveTextContent('Closed · reopen')
    expect(screen.getByTestId('status-sections-4')).toContainElement(hit)
    expect(screen.getByTestId('status-sections-9')).not.toContainElement(hit)
    await user.click(hit)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'closed', paneId: null }))
  })
})
