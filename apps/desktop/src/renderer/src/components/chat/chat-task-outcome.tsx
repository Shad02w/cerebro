import { CircleCheck, CircleStop, CircleX } from 'lucide-react'
import type { AgentBackgroundTask } from '@cerebro/core'
import { cn } from '@/lib/utils'

const outcomes = {
  completed: { label: 'Completed', icon: CircleCheck, tone: 'text-emerald-500' },
  failed: { label: 'Failed', icon: CircleX, tone: 'text-red-500' },
  stopped: { label: 'Stopped', icon: CircleStop, tone: 'text-muted-foreground' },
  running: { label: 'Running', icon: CircleStop, tone: 'text-muted-foreground' }
} as const

function duration(task: AgentBackgroundTask): string | null {
  if (!task.endedAt || !task.startedAt || task.endedAt < task.startedAt) return null
  const seconds = Math.round((task.endedAt - task.startedAt) / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function ChatTaskOutcome({
  task,
  text
}: {
  task: AgentBackgroundTask
  text: string
}): React.JSX.Element {
  const outcome = outcomes[task.status]
  const Icon = outcome.icon
  const meta = [
    task.exitCode === undefined ? null : `exit ${task.exitCode}`,
    duration(task)
  ].filter(Boolean)
  return (
    <div
      className="flex items-start gap-2 text-xs text-muted-foreground"
      data-testid="chat-task-outcome"
      data-task-status={task.status}
    >
      <Icon className={cn('mt-px size-3.5 shrink-0', outcome.tone)} aria-label={outcome.label} />
      <span className="min-w-0 flex-1 break-words">
        {text}
        {meta.length ? <span className="ml-2 opacity-70">{meta.join(' · ')}</span> : null}
      </span>
    </div>
  )
}
