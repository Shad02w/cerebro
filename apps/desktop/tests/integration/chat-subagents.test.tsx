import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession, AgentSubagent } from '@cerebro/core'
import { ChatSessionChips } from '@/components/chat/chat-session-chips'

const child = (
  patch: Partial<AgentSubagent> & Pick<AgentSubagent, 'id' | 'status'>
): AgentSubagent => ({
  title: '',
  createdAt: 0,
  ...patch
})

const session = (subagents: AgentSession['subagents']): AgentSession =>
  ({ id: 'session', subagents }) as AgentSession

const NOW = 1_000_000_000_000

describe('ChatSubagents', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens a grid above the Agents button', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    render(
      <ChatSessionChips
        session={session([
          child({ id: 'explore', status: 'created', title: 'explore-auth' }),
          child({
            id: 'review',
            status: 'running',
            title: 'review-diff',
            startedAt: NOW - 5_000
          }),
          child({
            id: 'duration',
            status: 'running',
            title: 'duration-clock',
            startedAt: 0,
            durationMs: 120_000
          }),
          child({
            id: 'write',
            status: 'completed',
            title: 'write-tests',
            startedAt: 0,
            finishedAt: 153_000,
            tokens: { input: 12_104, output: 6_316, total: 18_420 },
            model: 'sonnet',
            effort: 'high'
          }),
          child({
            id: 'lint',
            status: 'completed',
            title: 'lint-pass',
            startedAt: 0,
            finishedAt: 18_000,
            model: 'opus'
          }),
          child({
            id: 'nameless',
            status: 'stopped',
            startedAt: 0,
            finishedAt: 3_660_000
          }),
          child({
            id: 'small',
            status: 'completed',
            title: 'small-count',
            startedAt: 0,
            finishedAt: 1_000,
            tokens: { total: 420 },
            effort: 'low'
          }),
          child({
            id: 'round',
            status: 'completed',
            title: 'round-thousand',
            startedAt: 0,
            finishedAt: 1_000,
            tokens: { total: 1_000 }
          }),
          child({
            id: 'million',
            status: 'completed',
            title: 'million-tokens',
            startedAt: 0,
            finishedAt: 1_000,
            tokens: { total: 1_200_000 }
          })
        ])}
      />
    )
    const chip = screen.getByRole('button', { name: '9 agents' })
    expect(chip).toHaveTextContent('Agents')
    expect(chip).not.toHaveTextContent(/sub-?agent/i)
    expect(screen.queryByTestId('chat-subagents')).toBeNull()
    await userEvent.setup().click(chip)
    const dropdown = await screen.findByTestId('chat-subagents')
    const grid = within(dropdown).getByLabelText('Agents')
    expect(dropdown).not.toHaveTextContent('Elapsed')
    expect(dropdown).not.toHaveTextContent('Tokens')
    expect(dropdown).not.toHaveTextContent(/sub-?agent/i)
    expect(grid).toHaveClass('grid')
    const cells = (row: HTMLElement): string[] =>
      [...row.querySelectorAll('[data-cell]')].map((cell) => cell.textContent ?? '')
    const rows = within(grid).getAllByTestId('chat-subagent')
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual([
      'created',
      'running',
      'running',
      'completed',
      'completed',
      'stopped',
      'completed',
      'completed',
      'completed'
    ])
    expect(cells(rows[0])).toEqual(['', 'explore-auth', '', '', ''])
    expect(cells(rows[1])).toEqual(['', 'review-diff', '', '5s', ''])
    expect(cells(rows[2])).toEqual(['', 'duration-clock', '', '2m 0s', ''])
    expect(cells(rows[3])).toEqual([
      '',
      'write-tests',
      'sonnet · high',
      '2m 33s',
      '18.4k (12.1k in, 6.3k out)'
    ])
    expect(cells(rows[4])).toEqual(['', 'lint-pass', 'opus', '18s', 'no tokens'])
    expect(cells(rows[5])).toEqual(['', 'nameless', '', '1h 1m', 'no tokens'])
    expect(cells(rows[6])).toEqual(['', 'small-count', 'low', '1s', '420'])
    expect(cells(rows[7])).toEqual(['', 'round-thousand', '', '1s', '1k'])
    expect(cells(rows[8])).toEqual(['', 'million-tokens', '', '1s', '1.2m'])
    expect(rows[0].querySelector('.agent-status-dots')).not.toBeNull()
    expect(rows[1].querySelector('[aria-label="Agent running"]')).not.toBeNull()
    expect(rows[1].querySelector('.animate-spin')).toBeNull()
    expect(rows[3].querySelector('.agent-status-dot')).not.toBeNull()
    expect(rows[3].querySelector('[aria-label="Agent finished"]')).toHaveClass('text-emerald-500')
    expect(rows[5].querySelector('.agent-status-dots')).toBeNull()
  })

  it('sits to the right of Todo and Background', () => {
    const mixed = {
      id: 'session',
      todo: {
        kind: 'todo',
        listId: 'session:chat:todo',
        items: [{ id: '1', label: 'Inspect', status: 'pending' }]
      },
      background: [{ id: 'server', title: 'nr dev', status: 'running', startedAt: 1 }],
      subagents: [child({ id: 'explore', status: 'running', title: 'explore-auth' })]
    } as AgentSession
    render(<ChatSessionChips session={mixed} />)
    const buttons = within(screen.getByRole('toolbar', { name: 'Session status' })).getAllByRole(
      'button'
    )
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      '1 task',
      '1 background job',
      '1 agent'
    ])
  })

  it('renders nothing when the session has no sub-agents', () => {
    const { container } = render(<ChatSessionChips session={session(undefined)} />)
    expect(container).toBeEmptyDOMElement()
    render(<ChatSessionChips session={session([])} />)
    expect(screen.queryByTestId('chat-subagent-chip')).toBeNull()
  })
})
