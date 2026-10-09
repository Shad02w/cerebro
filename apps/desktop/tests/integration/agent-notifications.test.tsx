import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppNotification } from '@cerebro/core'
import { AgentNotifications } from '@/components/agent-notifications'

type Listener = (
  event: { type: 'show'; notification: AppNotification } | { type: 'dismiss'; id: string }
) => void

const blocked: AppNotification = {
  id: 'agent:s1',
  kind: 'blocked',
  title: 'cerebro / notifications',
  body: 'Cerebro needs your approval · Bash\ngit push',
  command: 'git push',
  target: { workspaceId: 2, sessionId: 's1', paneId: 7 },
  request: { id: 'p1', kind: 'approval' },
  actions: [
    { id: 'allow', label: 'Allow' },
    { id: 'deny', label: 'Deny' }
  ]
}
const finished: AppNotification = {
  id: 'agent:s2',
  kind: 'finished',
  title: 'cerebro / other',
  body: 'Done: Fixed the redirect.',
  target: { workspaceId: 3, sessionId: 's2', paneId: 8 }
}

describe('AgentNotifications', () => {
  let emit: Listener
  const respond = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    window.cerebro = {
      onNotification: (listener: Listener) => {
        emit = listener
        return () => {}
      },
      respondToNotification: respond
    } as unknown as typeof window.cerebro
  })
  afterEach(() => vi.useRealTimers())

  const show = (notification: AppNotification): void =>
    act(() => emit({ type: 'show', notification }))

  it('renders nothing until a notification arrives', () => {
    render(<AgentNotifications />)
    expect(screen.queryByTestId('agent-notification')).toBeNull()
  })

  it('shows project title and body, and Allow sends the answer then removes the card', async () => {
    render(<AgentNotifications />)
    show(blocked)
    expect(screen.getByText('cerebro / notifications')).toBeVisible()
    expect(screen.getByText('Cerebro needs your approval · Bash')).toBeVisible()
    expect(screen.getByTestId('agent-notification-command')).toHaveTextContent('git push')
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(respond).toHaveBeenCalledWith({
      type: 'action',
      notification: blocked,
      actionId: 'allow'
    })
    expect(screen.queryByTestId('agent-notification')).toBeNull()
  })

  it('clicking the body opens the pane', async () => {
    render(<AgentNotifications />)
    show(finished)
    await userEvent.click(screen.getByText('Done: Fixed the redirect.'))
    expect(respond).toHaveBeenCalledWith({ type: 'open', notification: finished })
  })

  it('a newer notification for the same session replaces the old card', () => {
    render(<AgentNotifications />)
    show(blocked)
    show({ ...finished, id: blocked.id })
    expect(screen.getAllByTestId('agent-notification')).toHaveLength(1)
    expect(screen.getByTestId('agent-notification')).toHaveAttribute('data-kind', 'finished')
  })

  it('a dismiss event removes the card', () => {
    render(<AgentNotifications />)
    show(blocked)
    act(() => emit({ type: 'dismiss', id: blocked.id }))
    expect(screen.queryByTestId('agent-notification')).toBeNull()
  })

  it('finished cards auto-dismiss but blocked cards stay', () => {
    vi.useFakeTimers()
    render(<AgentNotifications />)
    show(blocked)
    show(finished)
    act(() => {
      vi.advanceTimersByTime(9000)
    })
    const cards = screen.getAllByTestId('agent-notification')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveAttribute('data-kind', 'blocked')
  })
})
