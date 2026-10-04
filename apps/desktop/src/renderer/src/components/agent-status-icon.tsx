import { Ban, CircleDashed, ShieldAlert, XCircle } from 'lucide-react'
import type { AgentActivityStatus } from '@cerebro/core'
import { cn } from '@/lib/utils'
import './agent-status.css'

const presentation = {
  running: { label: 'Agent running', Icon: CircleDashed, color: 'text-sky-500' },
  waiting: { label: 'Agent needs your action', Icon: ShieldAlert, color: 'text-amber-500' },
  failed: { label: 'Agent failed', Icon: XCircle, color: 'text-red-500' },
  interrupted: { label: 'Agent interrupted', Icon: Ban, color: 'text-orange-500' }
} as const

export function AgentStatusIcon({
  status,
  surface,
  muted = false,
  testId,
  className
}: {
  status: AgentActivityStatus
  surface: 'sidebar' | 'tab'
  muted?: boolean
  testId?: string
  className?: string
}): React.JSX.Element {
  const { label, Icon, color } = presentation[status]
  const motion =
    surface === 'sidebar' && status === 'running'
      ? 'agent-status-spin'
      : surface === 'sidebar' && status === 'waiting'
        ? 'agent-status-pulse'
        : undefined
  return (
    <span
      role="img"
      aria-label={label}
      data-testid={testId}
      data-workspace-agent-status={surface === 'sidebar' ? status : undefined}
      data-chat-agent-status={surface === 'tab' ? status : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        color,
        muted && 'opacity-60',
        className
      )}
    >
      <Icon aria-hidden className={cn(surface === 'tab' ? 'size-2.5' : 'size-3.5', motion)} />
    </span>
  )
}
