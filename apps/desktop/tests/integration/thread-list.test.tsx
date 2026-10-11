import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ThreadRow } from '@cerebro/core'
import { ThreadList } from '@/components/thread-list'

const review: ThreadRow = {
  id: 'review',
  workspaceId: 1,
  repositoryId: null,
  paneId: null,
  harness: 'codex',
  location: 'notes / main',
  title: 'Check the notes',
  description: 'Adapter connected.',
  status: 'waiting for review',
  updatedAt: 2,
  open: true
}

describe('ThreadList status groups', () => {
  it('discloses threads under a full-width dropdown header', async () => {
    render(
      <ThreadList
        rows={[review]}
        projects={[]}
        activePaneId={null}
        searching={false}
        onOpen={vi.fn()}
      />
    )
    const header = screen.getByTestId('thread-group-waiting-for-review')
    expect(header).toHaveClass('w-full')
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(header).toHaveTextContent('Waiting for review')
    expect(header.querySelector('svg')).not.toBeNull()
    expect(screen.queryByTestId('thread-count-waiting-for-review')).toBeNull()
    expect(screen.getByTestId('thread-row-review')).toBeInTheDocument()

    await userEvent.setup().click(header)

    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('thread-row-review')).toBeNull()
  })
})
