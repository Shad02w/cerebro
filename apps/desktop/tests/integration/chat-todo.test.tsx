import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TodoSnapshot } from '@cerebro/core'
import { ChatTodo } from '@/components/chat/chat-todo'

const todo = (items: TodoSnapshot['items']): TodoSnapshot => ({
  kind: 'todo',
  listId: 'session:chat:todo',
  items
})

describe('ChatTodo', () => {
  it('renders the session checklist and the in-progress phrase', () => {
    render(
      <ChatTodo
        todo={todo([
          { id: '1', label: 'Inspect', status: 'completed', activeLabel: 'Inspecting' },
          {
            id: '2',
            label: 'Connect',
            status: 'in_progress',
            activeLabel: 'Connecting adapters'
          },
          { id: '3', label: 'Ship the list', status: 'pending', activeLabel: 'Shipping the list' }
        ])}
      />
    )
    expect(screen.getByRole('region', { name: 'Tasks, 1 of 3 complete' })).toHaveTextContent(
      'Tasks 1/3'
    )
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

  it('shows the label when an in-progress row has no phrase', () => {
    render(
      <ChatTodo todo={todo([{ id: '1', label: 'Connect the adapters', status: 'in_progress' }])} />
    )
    expect(screen.getByTestId('chat-todo-item')).toHaveTextContent('Connect the adapters')
  })

  it('clears the card when the checklist is missing or empty', () => {
    const { container, rerender } = render(<ChatTodo todo={undefined} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ChatTodo todo={todo([])} />)
    expect(container).toBeEmptyDOMElement()
  })
})
