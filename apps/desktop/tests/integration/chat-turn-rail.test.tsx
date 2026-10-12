import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChatTurnRail } from '@/components/chat/chat-turn-rail'
import type { ChatTurnSummary } from '@/components/chat/chat-turns'

const turns: ChatTurnSummary[] = [
  { turnId: 't1', prompt: 'First question', response: 'First answer', finished: true },
  { turnId: 't2', prompt: 'Second question', response: 'Still writing', finished: false },
  { turnId: 't3', prompt: 'Third question', response: 'Third answer', finished: true }
]

describe('ChatTurnRail', () => {
  it('stays hidden until the session has more than one turn', () => {
    const { container, rerender } = render(
      <ChatTurnRail turns={[]} activeTurnId={null} onSelect={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<ChatTurnRail turns={turns.slice(0, 1)} activeTurnId="t1" onSelect={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stacks turns from the first question and jumps to the clicked turn', async () => {
    const onSelect = vi.fn()
    render(<ChatTurnRail turns={turns} activeTurnId="t2" onSelect={onSelect} />)
    const rail = screen.getByRole('navigation', { name: 'Conversation turns' })
    const markers = within(rail).getAllByTestId('chat-turn-marker')
    expect(markers.map((marker) => marker.getAttribute('aria-label'))).toEqual([
      'Go to turn 1: First question',
      'Go to turn 2: Second question',
      'Go to turn 3: Third question'
    ])
    expect(markers[1]).toHaveAttribute('aria-current', 'true')
    expect(markers[0]).not.toHaveAttribute('aria-current')
    await userEvent.setup().click(markers[0])
    expect(onSelect).toHaveBeenCalledWith('t1')
  })

  it('shows the prompt and a finished response on hover, and only the prompt while a turn is running', async () => {
    const user = userEvent.setup()
    render(<ChatTurnRail turns={turns} activeTurnId="t1" onSelect={() => {}} />)
    const [first, second] = screen.getAllByTestId('chat-turn-marker')
    await user.hover(first)
    const finished = await screen.findByTestId('chat-turn-popover')
    expect(finished).toHaveTextContent('First question')
    expect(finished).toHaveTextContent('First answer')
    expect(first).toHaveAttribute('data-open', 'true')
    await user.unhover(first)
    await user.hover(second)
    const running = await screen.findByTestId('chat-turn-popover')
    expect(running).toHaveTextContent('Second question')
    expect(running).not.toHaveTextContent('Still writing')
  })
})
