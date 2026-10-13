import { render, screen } from '@testing-library/react'
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
    expect(preview).toHaveTextContent(/^echo segment/)
    expect(preview).toHaveTextContent(/\.\.\.\.$/)
    expect(preview.textContent).not.toContain('tail')
    expect(preview.className).toContain('group-open:hidden')
    expect(screen.getByText(/Bash/)).toBeInTheDocument()

    await userEvent.click(screen.getByText(/Bash/))
    expect(screen.getByTestId('command-run')).toHaveAttribute('open')
    expect(screen.getByTestId('command-full')).toHaveTextContent(command)
    expect(screen.getByText(/Print segments/)).toBeInTheDocument()
    expect(screen.getByText(/printed-line/)).toBeInTheDocument()
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
