import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatTurnActions } from '@/components/chat/chat-turn-actions'

function renderActions(): void {
  render(
    <ChatTurnActions
      workspaceId={1}
      paneId={2}
      repositoryId={3}
      sessionId="session"
      turnId="t1"
      text="Answer"
      forkCapability="native"
    />
  )
}

describe('chat turn actions', () => {
  beforeEach(() => {
    window.cerebro = {
      chatCommand: vi.fn(async () => {
        throw new Error(
          "Error invoking remote method 'cerebro:chat:command': Error: That section is no longer part of this conversation."
        )
      }),
      layoutCommand: vi.fn()
    } as unknown as typeof window.cerebro
  })

  it('reports a failed fork in a toast, not as text beside the buttons', async () => {
    const user = userEvent.setup()
    renderActions()
    await user.click(screen.getByTestId('chat-fork-trigger'))
    await user.click(await screen.findByTestId('chat-fork-new-tab'))
    const toast = await screen.findByTestId('chat-turn-copy-toast')
    expect(toast).toHaveTextContent(/^That section is no longer part of this conversation\./)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByTestId('chat-turn-actions')).not.toHaveTextContent(
      'no longer part of this conversation'
    )
  })
})
