import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentQuestion, ChatItem as Item } from '@cerebro/core'

vi.mock('@/components/chat/chat-user-message', () => ({ ChatUserMessage: () => null }))
vi.mock('@/components/markdown/agent-markdown', () => ({ AgentMarkdown: () => null }))
vi.mock('@/components/chat/chat-diff', () => ({ ChatDiff: () => null }))

import { ChatItem } from '@/components/chat/chat-item'
import type { ReplyHandler } from '@/components/chat/question-card'

const storage: AgentQuestion = {
  id: '0',
  label: 'Where should session history be stored?',
  header: 'Storage',
  options: ['Mux database', 'JSON files'],
  descriptions: { 'Mux database': 'Reuses the storage worker.' }
}
const harnesses: AgentQuestion = {
  id: '1',
  label: 'Which harnesses should retry on rate limits?',
  header: 'Harnesses',
  options: ['Claude Code', 'Codex'],
  multiple: true
}

const request = (questions: AgentQuestion[], patch: Partial<Item> = {}): Item => ({
  id: 'request:r1',
  turnId: 'turn',
  kind: 'request',
  title: 'AskUserQuestion',
  text: '',
  status: 'running',
  request: { id: 'r1', kind: 'question', questions },
  ...patch
})

function renderCard(
  item: Item,
  onReply: ReplyHandler = vi.fn(async () => true)
): { onReply: ReplyHandler; card: HTMLElement | null } {
  render(<ChatItem item={item} onReply={onReply} workspaceId={1} sessionId="session" />)
  return { onReply, card: screen.queryByTestId('question-card') }
}

describe('question card', () => {
  it('answers one question with the keyboard and shows option descriptions', async () => {
    const user = userEvent.setup()
    const { onReply, card } = renderCard(request([storage]))
    expect(screen.queryByRole('tab', { name: 'Review' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Mux database' })).toHaveTextContent(
      'Reuses the storage worker.'
    )
    card!.focus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onReply).toHaveBeenCalledWith('r1', { allow: true, answers: { '0': ['JSON files'] } })
  })

  it('walks tabs to Review and submits every answer', async () => {
    const user = userEvent.setup()
    const { onReply, card } = renderCard(request([storage, harnesses]))
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Storage',
      'Harnesses',
      'Review'
    ])
    card!.focus()
    await user.keyboard('1')
    expect(screen.getByText('Which harnesses should retry on rate limits?')).toBeInTheDocument()
    await user.keyboard('12{Enter}')
    const review = screen.getByTestId('question-review')
    expect(within(review).getByText('Mux database')).toBeInTheDocument()
    expect(within(review).getByText('Claude Code, Codex')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))
    expect(onReply).toHaveBeenCalledWith('r1', {
      allow: true,
      answers: { '0': ['Mux database'], '1': ['Claude Code', 'Codex'] }
    })
  })

  it('validates inline instead of sending an incomplete reply', async () => {
    const user = userEvent.setup()
    const { onReply } = renderCard(request([storage, harnesses]))
    await user.click(screen.getByRole('tab', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Answer “Storage” before submitting.')
    expect(screen.getByText('Where should session history be stored?')).toBeInTheDocument()
    expect(onReply).not.toHaveBeenCalled()
    await user.click(screen.getByRole('radio', { name: 'JSON files' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('takes a typed answer from the free-text row', async () => {
    const user = userEvent.setup()
    const { onReply, card } = renderCard(request([storage]))
    card!.focus()
    await user.keyboard('3')
    const field = screen.getByRole('textbox', { name: /Other answer/ })
    expect(field).toHaveFocus()
    await user.keyboard('SQLite elsewhere{Enter}')
    expect(onReply).toHaveBeenCalledWith('r1', {
      allow: true,
      answers: { '0': ['SQLite elsewhere'] }
    })
  })

  it('keeps keyboard focus on the card after Esc leaves the free-text row', async () => {
    const user = userEvent.setup()
    const { onReply, card } = renderCard(request([storage]))
    card!.focus()
    await user.keyboard('3x{Escape}')
    expect(card).toHaveFocus()
    await user.keyboard('{Escape}{Escape}')
    expect(onReply).toHaveBeenCalledWith('r1', { allow: false, answers: {} })
  })

  it('skips with Esc pressed twice, sending a decline', async () => {
    const user = userEvent.setup()
    const { onReply, card } = renderCard(request([storage, harnesses]))
    card!.focus()
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('question-hints')).toHaveTextContent('Press Esc again to skip')
    expect(onReply).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onReply).toHaveBeenCalledWith('r1', { allow: false, answers: {} })
  })

  it('ignores a second submit while the first is still in flight', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const onReply = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    renderCard(request([storage]), onReply)
    await user.click(screen.getByRole('radio', { name: 'Mux database' }))
    const submit = screen.getByRole('button', { name: 'Submit answer' })
    await user.click(submit)
    await user.click(submit)
    expect(submit).toBeEnabled()
    expect(onReply).toHaveBeenCalledTimes(1)
    finish(true)
  })

  it('shows answered questions as chips instead of raw JSON', () => {
    renderCard(
      request([storage, harnesses], {
        status: 'completed',
        text: JSON.stringify({ '0': ['Mux database'], '1': ['Claude Code', 'Codex'] }),
        request: { id: 'r1', kind: 'question', questions: [storage, harnesses], resolved: true }
      })
    )
    const answered = screen.getByTestId('question-answered')
    expect(answered).toHaveTextContent('Storage: Mux database')
    expect(answered).toHaveTextContent('Harnesses: Claude Code, Codex')
    expect(answered.textContent).not.toContain('{')
  })

  it('says a skipped question was skipped', () => {
    renderCard(
      request([storage], {
        status: 'completed',
        text: 'Declined',
        request: { id: 'r1', kind: 'question', questions: [storage], resolved: true }
      })
    )
    expect(screen.getByTestId('question-skipped')).toHaveTextContent('Skipped')
  })

  it('leaves approvals on the Allow once / Decline card', async () => {
    const user = userEvent.setup()
    const { onReply, card } = renderCard({
      id: 'request:a1',
      turnId: 'turn',
      kind: 'request',
      title: 'Bash',
      text: 'rm -rf build',
      status: 'running',
      request: { id: 'a1', kind: 'approval' }
    })
    expect(card).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(onReply).toHaveBeenCalledWith('a1', { allow: true, answers: {} })
  })
})
