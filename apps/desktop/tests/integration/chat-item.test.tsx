import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChatItem as Item } from '@cerebro/core'

vi.mock('@/components/chat/chat-user-message', () => ({ ChatUserMessage: () => null }))
vi.mock('@/components/markdown/agent-markdown', () => ({ AgentMarkdown: () => null }))
vi.mock('@/components/chat/chat-diff', () => ({ ChatDiff: () => null }))

import { ChatItem } from '@/components/chat/chat-item'

const item = (patch: Partial<Item>): Item => ({
  id: '1',
  turnId: 'turn',
  kind: 'tool',
  text: '',
  ...patch
})

describe('ChatItem command runs', () => {
  it('shows a .... preview while collapsed and the full command after expand', async () => {
    const command = `echo ${'segment '.repeat(30)}tail`
    render(
      <ChatItem
        item={item({
          title: 'Bash',
          status: 'completed',
          input: JSON.stringify({ command, description: 'Print segments' }),
          text: 'printed-line\nprinted-line\n'
        })}
        onReply={() => {}}
        workspaceId={1}
        sessionId="session"
      />
    )
    const preview = screen.getByTestId('command-preview')
    const row = screen.getByTestId('command-run')
    expect(preview).toHaveTextContent(/^Bash echo segment/)
    expect(preview).toHaveTextContent(/\.\.\.\.$/)
    expect(preview.textContent).not.toContain('>')
    expect(preview.textContent).not.toContain('tail')
    expect(preview.textContent).not.toContain('printed-line')
    expect(preview.className).toContain('truncate')
    expect(preview.className).not.toContain('chat-working')
    expect(row.className).not.toContain('border')
    expect(screen.queryByTestId('tool-working')).toBeNull()

    await userEvent.click(preview)
    expect(screen.getByTestId('command-run')).toHaveAttribute('open')
    expect(screen.getByTestId('command-full')).toHaveTextContent(command)
    expect(screen.getByText(/Print segments/)).toBeInTheDocument()
    expect(screen.getByText(/printed-line/)).toBeInTheDocument()
  })

  it('uses the shimmer and a working timer while the command is running', () => {
    vi.useFakeTimers()
    try {
      render(
        <ChatItem
          item={item({
            title: 'Bash',
            status: 'running',
            input: JSON.stringify({ command: 'npm test' })
          })}
          onReply={() => {}}
          workspaceId={1}
          sessionId="session"
        />
      )
      const preview = screen.getByTestId('command-preview')
      expect(preview).toHaveTextContent('Bash npm test')
      expect(preview).toHaveClass('chat-working')
      expect(screen.getByTestId('tool-working')).toHaveTextContent('working for 0s')
      expect(screen.getByTestId('tool-working')).toHaveClass('chat-working')
      expect(
        screen.getByTestId('command-run').querySelector('[data-tool-icon="shell"]')
      ).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByTestId('tool-working')).toHaveTextContent('working for 2s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a different icon for each tool', () => {
    const { rerender } = render(
      <ChatItem
        item={item({ title: 'Read', input: '{"file_path":"a.ts"}', text: 'export const a = 1\n' })}
        onReply={() => {}}
        workspaceId={1}
        sessionId="session"
      />
    )
    expect(screen.queryByTestId('command-preview')).toBeNull()
    expect(document.querySelector('[data-tool-icon="read"]')).toBeTruthy()

    rerender(
      <ChatItem
        item={item({ title: 'WebSearch', status: 'running', text: 'results' })}
        onReply={() => {}}
        workspaceId={1}
        sessionId="session"
      />
    )
    expect(document.querySelector('[data-tool-icon="web"]')).toBeTruthy()
    expect(screen.getByText(/WebSearch/)).toHaveClass('chat-working')
    expect(screen.getByTestId('tool-call').className).not.toContain('border')
    expect(screen.getByTestId('tool-working')).toHaveTextContent(/^working for \d+s$/)
  })

  it('does not preview a file tool', () => {
    render(
      <ChatItem
        item={item({ title: 'Read', input: '{"file_path":"a.ts"}', text: 'export const a = 1\n' })}
        onReply={() => {}}
        workspaceId={1}
        sessionId="session"
      />
    )
    expect(screen.queryByTestId('command-preview')).toBeNull()
    expect(screen.getByText('Read')).toBeInTheDocument()
  })
})
