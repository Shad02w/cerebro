import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AgentSession, TodoSnapshot } from '@cerebro/core'
import { ChatSessionChips } from '@/components/chat/chat-session-chips'
import { ChatTodo } from '@/components/chat/chat-todo'

const todo = (items: TodoSnapshot['items']): TodoSnapshot => ({
  kind: 'todo',
  listId: 'session:chat:todo',
  items
})

const list = todo([
  { id: '1', label: 'Inspect', status: 'completed', activeLabel: 'Inspecting' },
  { id: '2', label: 'Connect', status: 'in_progress', activeLabel: 'Connecting adapters' },
  { id: '3', label: 'Ship the list', status: 'pending', activeLabel: 'Shipping the list' }
])

describe('ChatTodo', () => {
  it('opens the session checklist above the button', async () => {
    render(<ChatTodo todo={list} />)
    const chip = screen.getByRole('button', { name: '3 tasks' })
    expect(chip).toHaveTextContent('Tasks3')
    expect(screen.queryByTestId('chat-todo')).toBeNull()
    await userEvent.setup().click(chip)
    const dropdown = await screen.findByTestId('chat-todo')
    expect(dropdown).toHaveTextContent('Tasks 1/3')
    expect(within(dropdown).getByRole('list', { name: 'Tasks' })).toBeInTheDocument()
    const rows = screen.getAllByTestId('chat-todo-item')
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual([
      'completed',
      'in_progress',
      'pending'
    ])
    expect(within(rows[0]).getByText('Inspect')).toHaveClass('line-through')
    expect(within(rows[0]).queryByText('Inspecting')).toBeNull()
    expect(within(rows[1]).getByText('Connect')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Connecting adapters')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Ship the list')).toBeInTheDocument()
    expect(within(rows[2]).queryByText('Shipping the list')).toBeNull()
  })

  it('shows the label when an in-progress row has no phrase', async () => {
    render(
      <ChatTodo todo={todo([{ id: '1', label: 'Connect the adapters', status: 'in_progress' }])} />
    )
    await userEvent.setup().click(screen.getByRole('button', { name: '1 task' }))
    expect(await screen.findByTestId('chat-todo-item')).toHaveTextContent('Connect the adapters')
  })

  it('hides the button when the checklist is missing or empty', () => {
    const { container, rerender } = render(<ChatTodo todo={undefined} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ChatTodo todo={todo([])} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('places the checklist button to the left of background jobs', () => {
    const session = {
      id: 'session',
      todo: list,
      background: [{ id: 'server', title: 'nr dev', status: 'running', startedAt: 1 }]
    } as AgentSession
    render(<ChatSessionChips session={session} />)
    const buttons = within(screen.getByRole('toolbar', { name: 'Session status' })).getAllByRole(
      'button'
    )
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      '3 tasks',
      '1 background job'
    ])
  })
})
