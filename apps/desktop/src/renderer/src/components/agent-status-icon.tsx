import type { AgentActivityStatus } from '@cerebro/core'
import { agentStatusPresentation } from '@/lib/agent-activity'
import { cn } from '@/lib/utils'
import './agent-status.css'

/** Four dots in a square for a running agent. Every other status is one small dot. */
export function AgentStatusMark({
  status
}: {
  status: Exclude<AgentActivityStatus, 'idle'>
}): React.JSX.Element {
  if (status === 'running') {
    return (
      <span className="agent-status-dots" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </span>
    )
  }
  return <span aria-hidden className="agent-status-dot" />
}

/** Status mark used by both sidebar agent icons and chat tab titles. */
export function AgentStatusIcon({
  status,
  surface,
  className
}: {
  status: Exclude<AgentActivityStatus, 'idle'>
  surface: 'sidebar' | 'tab'
  className?: string
}): React.JSX.Element {
  const { label, color } = agentStatusPresentation[status]
  return (
    <span
      role="img"
      aria-label={label}
      data-workspace-agent-status={surface === 'sidebar' ? status : undefined}
      data-chat-agent-status={surface === 'tab' ? status : undefined}
      className={cn('inline-flex shrink-0 items-center justify-center', color, className)}
    >
      <AgentStatusMark status={status} />
    </span>
  )
}
