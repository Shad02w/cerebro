import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AgentSubagent } from '@cerebro/core'
import { ChatAgentFinished } from '@/components/chat/chat-agent-finished'

const agent = (patch: Partial<AgentSubagent> = {}): AgentSubagent => ({
  id: 'agent-1',
  title: 'Review the diff',
  status: 'completed',
  createdAt: 0,
  model: 'sonnet',
  effort: 'high',
  durationMs: 153_000,
  tokens: { total: 18_420 },
  ...patch
})

describe('ChatAgentFinished', () => {
  it('uses the tab done mark and the finish line', () => {
    const text = 'Agent "Review the diff" finished · sonnet · high · 2m 33s · 18.4k'
    render(<ChatAgentFinished agent={agent()} text={text} />)
    const line = screen.getByTestId('chat-agent-finished')
    expect(line).toHaveTextContent(text)
    expect(line).not.toHaveTextContent(/sub-?agent/i)
    const mark = screen.getByLabelText('Agent finished')
    expect(mark).toHaveClass('text-emerald-500')
    expect(mark.querySelector('.agent-status-dot')).not.toBeNull()
    expect(line.querySelector('[data-chat-agent-status]')).toBeNull()
  })

  it('uses the failed mark when the child failed', () => {
    render(
      <ChatAgentFinished
        agent={agent({ status: 'failed' })}
        text='Agent "Review the diff" failed'
      />
    )
    expect(screen.getByLabelText('Agent failed')).toHaveClass('text-red-500')
  })
})
