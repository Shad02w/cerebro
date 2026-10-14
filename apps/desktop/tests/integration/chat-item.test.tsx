import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem as Item } from '@cerebro/core'
import { clearTurnDurations, recordTurnSeconds } from '@/components/chat/turn-durations'
import { TurnClock } from '@/components/chat/turn-clock'

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
    expect(preview).toHaveClass('block', 'w-full', 'truncate')
    expect(preview.className).not.toContain('chat-working')
    expect(preview.querySelector('.chat-working')).toHaveTextContent('Bash · Run tests')
    expect(screen.queryByText(/working for/i)).toBeNull()
    expect(screen.getByTestId('command-run').querySelector('[data-tool-icon="shell"]')).toBeTruthy()
  })

  it('keeps a long running bash line in the same truncated box', () => {
    const command = `echo ${'segment '.repeat(30)}tail`
    render(
      <ChatItem
        item={item({
          title: 'Bash',
          status: 'running',
          input: JSON.stringify({ command, description: 'Print segments' })
        })}
        onReply={() => {}}
        workspaceId={1}
        sessionId="session"
      />
    )
    const preview = screen.getByTestId('command-preview')
    expect(preview).toHaveClass('block', 'w-full', 'truncate')
    expect(preview.className).not.toContain('inline-block')
    expect(preview.className).not.toContain('chat-working')
    expect(preview.querySelector('.chat-working')).toHaveTextContent('Bash · Print segments')
    expect(preview.textContent).not.toContain('tail')
    const css = readFileSync(resolve('src/renderer/src/components/chat/chat-status.css'), 'utf8')
    expect(css).not.toMatch(/display\s*:/)
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
    expect(screen.getByTestId('tool-summary')).toHaveClass('block', 'truncate')
    expect(screen.getByTestId('tool-summary').querySelector('.chat-working')).toBeTruthy()
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

  it('shows only the latest running item while the turn is still streaming', () => {
    const { rerender } = render(
      <WorkingGroup
        live
        items={[
          item({
            id: 'read',
            title: 'Read',
            status: 'completed',
            input: '{"file_path":"a.ts"}'
          }),
          item({
            id: 'bash-done',
            title: 'Bash',
            status: 'completed',
            input: JSON.stringify({ command: 'pwd', description: 'Where am I' })
          }),
          item({
            id: 'bash',
            title: 'Bash',
            status: 'running',
            input: JSON.stringify({ command: 'npm test', description: 'Run tests' })
          })
        ]}
      />
    )
    const live = screen.getByTestId('working-live')
    expect(screen.queryByTestId('working-group')).toBeNull()
    expect(live).toHaveTextContent('Bash · Run tests')
    expect(live).not.toHaveTextContent('Where am I')
    expect(live).not.toHaveTextContent('a.ts')
    expect(live.querySelectorAll('summary')).toHaveLength(1)
    expect(screen.queryByText(/working for/i)).toBeNull()

    rerender(
      <WorkingGroup
        live
        items={[
          item({
            id: 'bash',
            title: 'Bash',
            status: 'running',
            input: JSON.stringify({ command: 'npm test', description: 'Run tests' })
          }),
          item({ id: 'r', kind: 'reasoning', status: 'running', text: 'still thinking' })
        ]}
      />
    )
    expect(screen.getByTestId('working-live')).toHaveTextContent('Reasoning')
    expect(screen.getByTestId('working-live')).toHaveTextContent('still thinking')
    expect(screen.queryByTestId('command-run')).toBeNull()

    rerender(
      <WorkingGroup
        live
        items={[
          item({
            id: 'bash',
            title: 'Bash',
            status: 'running',
            input: JSON.stringify({ command: 'npm test', description: 'Run tests' })
          }),
          item({ id: 'r', kind: 'reasoning', status: 'completed', text: 'settled thought' })
        ]}
      />
    )
    expect(screen.getByTestId('command-preview')).toHaveTextContent('Bash · Run tests')
    expect(screen.queryByText('settled thought')).toBeNull()
  })

  it('keeps reasoning inside the finished working section', () => {
    recordTurnSeconds('turn', 4)
    render(
      <WorkingGroup
        items={[
          item({ id: 'r1', kind: 'reasoning', status: 'completed', text: 'first thought' }),
          item({ id: 'skill', kind: 'tool', title: 'Skill', status: 'completed' }),
          item({ id: 'r2', kind: 'reasoning', status: 'completed', text: 'second thought' })
        ]}
      />
    )
    const group = screen.getByTestId('working-group')
    expect(group).toHaveTextContent('Working for 4s')
    expect(group).toHaveTextContent('first thought')
    expect(group).toHaveTextContent('Skill')
    expect(group).toHaveTextContent('second thought')
    expect(group.querySelectorAll('summary')).toHaveLength(4)

    const reasoning = screen.getAllByTestId('reasoning')
    const skill = screen.getByTestId('tool-call')
    expect(reasoning[0].className).not.toContain('border')
    expect(reasoning[0].querySelector('summary')?.className).toBe(
      skill.querySelector('summary')?.className
    )
    expect(screen.getAllByTestId('reasoning-summary').map((node) => node.textContent)).toEqual([
      'Reasoning',
      'Reasoning'
    ])
    expect(reasoning[0].querySelector('pre')).toHaveTextContent('first thought')
    expect(reasoning[1].querySelector('pre')).toHaveTextContent('second thought')
  })

  it('shows Working for Ns after a turn the view watched', () => {
    const { rerender } = render(
      <>
        <TurnClock active activeIds={['turn']} knownIds={['turn']} />
        <WorkingGroup
          live
          items={[item({ id: 'r1', kind: 'reasoning', status: 'running', text: 'first thought' })]}
        />
      </>
    )
    expect(screen.queryByTestId('working-group')).toBeNull()
    expect(screen.getByTestId('reasoning-summary')).toHaveTextContent('Reasoning')
    expect(screen.getByTestId('reasoning-summary')).toHaveClass('block', 'truncate')
    expect(screen.getByTestId('reasoning-summary').querySelector('.chat-working')).toBeTruthy()
    rerender(
      <>
        <TurnClock active={false} activeIds={[]} knownIds={['turn']} />
        <WorkingGroup
          items={[
            item({ id: 'r1', kind: 'reasoning', status: 'completed', text: 'first thought' }),
            item({ id: 'skill', kind: 'tool', title: 'Skill', status: 'completed' }),
            item({ id: 'r2', kind: 'reasoning', status: 'completed', text: 'second thought' })
          ]}
        />
      </>
    )
    const group = screen.getByTestId('working-group')
    expect(group).toHaveTextContent(/Working for \d+s/)
    expect(group).toHaveTextContent('first thought')
    expect(group).toHaveTextContent('Skill')
    expect(group).toHaveTextContent('second thought')
  })
})
