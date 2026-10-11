import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AgentSession } from '@cerebro/core'
import { ChatSessionChips } from '@/components/chat/chat-session-chips'

const session = (background: AgentSession['background']): AgentSession =>
  ({ id: 'session', background }) as AgentSession

describe('ChatSessionChips', () => {
  it('counts background jobs and lists them in a popover above the chip', async () => {
    render(
      <ChatSessionChips
        session={session([
          { id: 'server', title: 'nr dev', status: 'running', startedAt: 1 },
          { id: 'sleep', title: '', status: 'running', startedAt: 2 }
        ])}
      />
    )
    const chip = screen.getByRole('button', { name: '2 background jobs' })
    expect(chip).toHaveTextContent('Background2')
    expect(screen.queryByTestId('chat-background-tasks')).toBeNull()
    await userEvent.setup().click(chip)
    expect(await screen.findByRole('list', { name: 'Background jobs' })).toBeInTheDocument()
    expect(screen.getAllByTestId('chat-background-task').map((row) => row.textContent)).toEqual([
      'nr dev',
      'Background job'
    ])
  })

  it('uses the singular for one job', () => {
    render(
      <ChatSessionChips
        session={session([{ id: 'server', title: 'nr dev', status: 'running', startedAt: 1 }])}
      />
    )
    expect(screen.getByRole('button', { name: '1 background job' })).toHaveTextContent(
      'Background1'
    )
  })

  it('renders nothing when no background jobs are running', () => {
    const { container } = render(<ChatSessionChips session={session(undefined)} />)
    expect(container).toBeEmptyDOMElement()
    render(<ChatSessionChips session={session([])} />)
    expect(screen.queryByTestId('chat-session-chips')).toBeNull()
  })
})
