import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem as Item } from '@cerebro/core'
import { clearTurnDurations, recordTurnSeconds } from '@/components/chat/turn-durations'

vi.mock('@/components/chat/chat-user-message', () => ({ ChatUserMessage: () => null }))
vi.mock('@/components/markdown/agent-markdown', () => ({ AgentMarkdown: () => null }))
vi.mock('@/components/chat/chat-diff', () => ({ ChatDiff: () => null }))

import { ChatItem, WorkingGroup } from '@/components/chat/chat-item'

const item = (patch: Partial<Item>): Item => ({
  id: '1',
  turnId: 'turn',
  kind: 'tool',
  text: '',
  ...patch
})

describe('ChatItem command runs', () => {
  beforeEach(() => clearTurnDurations())

  it('shows the description after a dot and the full command after expand', async () => {
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
    expect(preview).toHaveTextContent('Bash · Print segments')
    expect(preview.textContent).not.toContain('>')
    expect(preview.textContent).not.toContain('completed')
    expect(preview.textContent).not.toContain('tail')
    expect(preview.className).toContain('truncate')
    expect(preview.className).not.toContain('chat-working')
    expect(row.className).not.toContain('border')
    expect(screen.queryByText(/working for/i)).toBeNull()

    await userEvent.click(preview)
    expect(screen.getByTestId('command-run')).toHaveAttribute('open')
    expect(screen.getByTestId('command-full')).toHaveTextContent(command)
    expect(screen.getByText(/printed-line/)).toBeInTheDocument()
  })

  it('shimmers a running command without a per-call timer', () => {
    render(
      <ChatItem
        item={item({
          title: 'Bash',
          status: 'running',
          input: JSON.stringify({ command: 'npm test', description: 'Run tests' })
        })}
        onReply={() => {}}
        workspaceId={1}
        sessionId="session"
      />
    )
    const preview = screen.getByTestId('command-preview')
    expect(preview).toHaveTextContent('Bash · Run tests')
    expect(preview).toHaveClass('chat-working')
    expect(screen.queryByText(/working for/i)).toBeNull()
    expect(screen.getByTestId('command-run').querySelector('[data-tool-icon="shell"]')).toBeTruthy()
  })

  it('uses a different icon and a description for each tool', () => {
    const { rerender } = render(
      <ChatItem
        item={item({ title: 'Read', input: '{"file_path":"a.ts"}', text: 'export const a = 1\n' })}
        onReply={() => {}}
        workspaceId={1}
        sessionId="session"
      />
    )
    expect(screen.getByTestId('tool-summary')).toHaveTextContent('Read · a.ts')
    expect(screen.getByTestId('tool-summary').textContent).not.toContain('completed')
    expect(document.querySelector('[data-tool-icon="read"]')).toBeTruthy()

    rerender(
      <ChatItem
        item={item({
          title: 'WebSearch',
          status: 'running',
          input: '{"query":"cerebro"}',
          text: 'results'
        })}
        onReply={() => {}}
        workspaceId={1}
        sessionId="session"
      />
    )
    expect(document.querySelector('[data-tool-icon="web"]')).toBeTruthy()
    expect(screen.getByTestId('tool-summary')).toHaveTextContent('WebSearch · cerebro')
    expect(screen.getByTestId('tool-summary')).toHaveClass('chat-working')
  })

  it('collapses a finished turn into one working section', async () => {
    recordTurnSeconds('turn', 4)
    render(
      <WorkingGroup
        items={[
          item({
            id: 'read',
            title: 'Read',
            status: 'completed',
            input: '{"file_path":"a.ts"}'
          }),
          item({
            id: 'bash',
            title: 'Bash',
            status: 'completed',
            input: JSON.stringify({ command: 'pwd', description: 'Where am I' })
          })
        ]}
      />
    )
    const group = screen.getByTestId('working-group')
    expect(group).not.toHaveAttribute('open')
    expect(screen.getByText('Working for 4s')).toBeInTheDocument()
    expect(screen.queryByText(/Working on/)).toBeNull()
    const summary = group.querySelector('summary')
    expect(summary).toHaveClass('text-sm')
    expect(summary?.textContent).toBe('Working for 4s')
    const disclosure = screen.getByTestId('working-disclosure')
    expect(summary?.contains(disclosure)).toBe(true)
    expect(summary?.lastElementChild).toBe(disclosure)

    await userEvent.click(screen.getByText(/Working for 4s/))
    expect(group).toHaveAttribute('open')
    expect(screen.getByTestId('tool-summary')).toHaveTextContent('Read · a.ts')
    expect(screen.getByTestId('command-preview')).toHaveTextContent('Bash · Where am I')
  })

  it('keeps tool lines visible while the turn is still streaming', () => {
    render(
      <WorkingGroup
        live
        items={[
          item({
            title: 'Bash',
            status: 'running',
            input: JSON.stringify({ command: 'npm test', description: 'Run tests' })
          })
        ]}
      />
    )
    expect(screen.queryByTestId('working-group')).toBeNull()
    expect(screen.getByTestId('working-live')).toHaveTextContent('Bash · Run tests')
    expect(screen.queryByText(/working for/i)).toBeNull()
  })
})
