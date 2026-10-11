import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AgentBackgroundTask } from '@cerebro/core'
import { ChatTaskOutcome } from '@/components/chat/chat-task-outcome'

const task = (patch: Partial<AgentBackgroundTask>): AgentBackgroundTask => ({
  id: 'task',
  title: 'sleep 4; exit 3',
  status: 'completed',
  startedAt: 1_000,
  ...patch
})

describe('ChatTaskOutcome', () => {
  it.each([
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['stopped', 'Stopped']
  ] as const)('labels a %s task', (status, label) => {
    render(<ChatTaskOutcome task={task({ status })} text="Background task" />)
    expect(screen.getByTestId('chat-task-outcome')).toHaveAttribute('data-task-status', status)
    expect(screen.getByLabelText(label)).toBeInTheDocument()
  })

  it('shows the exit code and duration when the harness reported them', () => {
    render(
      <ChatTaskOutcome
        task={task({ status: 'failed', exitCode: 3, endedAt: 5_200 })}
        text='Background command "sleep 4; exit 3" failed with exit code 3'
      />
    )
    expect(screen.getByTestId('chat-task-outcome')).toHaveTextContent(
      'Background command "sleep 4; exit 3" failed with exit code 3exit 3 · 4s'
    )
  })

  it('omits details the harness did not report', () => {
    render(
      <ChatTaskOutcome task={task({ status: 'stopped' })} text="Stopped when the agent closed." />
    )
    expect(screen.getByTestId('chat-task-outcome')).toHaveTextContent(
      /^Stopped when the agent closed\.$/
    )
  })
})
