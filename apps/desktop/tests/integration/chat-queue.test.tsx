import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@cerebro/core'
import { ChatQueue } from '@/components/chat/chat-queue'

const model = { key: 'claude:sonnet', label: 'Sonnet', harness: 'claude' }
const session = {
  id: 'session',
  model,
  accessMode: 'full',
  queue: [{ id: 'q1', text: 'please steer this in', model, accessMode: 'full' }]
} as unknown as AgentSession

function renderQueue(onEdit = vi.fn(async () => true)): {
  onSteer: ReturnType<typeof vi.fn>
  onEdit: typeof onEdit
} {
  const onSteer = vi.fn()
  render(<ChatQueue session={session} onSteer={onSteer} onDequeue={vi.fn()} onEdit={onEdit} />)
  return { onSteer, onEdit }
}

describe('chat queue', () => {
  it('steers from an icon button with no visible label', async () => {
    const user = userEvent.setup()
    const { onSteer } = renderQueue()
    const steer = screen.getByRole('button', { name: 'Steer' })
    expect(steer).not.toHaveTextContent('Steer')
    await user.click(steer)
    expect(onSteer).toHaveBeenCalledWith('q1')
  })

  it('edits a queued message in place and saves on Enter', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderQueue()
    await user.click(screen.getByRole('button', { name: 'Edit queued message' }))
    const field = screen.getByRole('textbox', { name: 'Queued message' })
    expect(field).toHaveFocus()
    expect(field).toHaveValue('please steer this in')
    await user.clear(field)
    await user.type(field, 'steer this instead{Enter}')
    expect(onEdit).toHaveBeenCalledWith('q1', 'steer this instead')
    expect(screen.queryByTestId('chat-queue-editor')).toBeNull()
  })

  it('keeps the editor open with an error for an empty message, and Escape cancels', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderQueue()
    await user.click(screen.getByRole('button', { name: 'Edit queued message' }))
    const field = screen.getByRole('textbox', { name: 'Queued message' })
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save queued message' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write a message first.')
    expect(onEdit).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('chat-queue-editor')).toBeNull()
    expect(screen.getByTestId('chat-queue-item')).toHaveTextContent('please steer this in')
  })
})
