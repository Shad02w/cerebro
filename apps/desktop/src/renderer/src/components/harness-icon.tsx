import type { AgentActivityStatus, AgentHarness } from '@cerebro/core'
import claudeIcon from '@/assets/agents/claude.svg'
import codexIcon from '@/assets/agents/codex.svg'
import piIcon from '@/assets/agents/pi.svg'
import { AgentStatusIcon } from '@/components/agent-status-icon'
import { harnessLabels } from '@/components/chat/queries'
import { cn } from '@/lib/utils'
import './agent-status.css'

const icons: Record<AgentHarness, string> = {
  claude: claudeIcon,
  codex: codexIcon,
  pi: piIcon
}

/** Masked harness logo, the same form as the agent tab title icon. */
export function HarnessIcon({
  harness,
  loading = false,
  testId,
  className
}: {
  harness: AgentHarness
  loading?: boolean
  testId?: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      role="img"
      aria-label={harnessLabels[harness]}
      data-testid={testId}
      data-harness-icon={harness}
      className={cn(
        'size-4 [mask-repeat:no-repeat] [mask-position:center] [mask-size:contain]',
        loading ? 'agent-harness-loading' : 'bg-current',
        harness === 'claude' && 'text-[#D97757]',
        className
      )}
      style={{ maskImage: `url("${icons[harness]}")` }}
    />
  )
}

/** Harness logo with the activity mark pinned to the bottom-right corner. */
export function HarnessStatusIcon({
  harness,
  status,
  surface,
  testId
}: {
  harness: AgentHarness
  status: Exclude<AgentActivityStatus, 'idle'>
  surface: 'sidebar' | 'tab'
  testId?: string
}): React.JSX.Element {
  // Pad the layout box so the absolute badge stays inside overflow-hidden ancestors.
  return (
    <span
      className="relative inline-flex size-4 shrink-0 pr-[3px] pb-[3px] box-content"
      data-agent-harness={harness}
    >
      <HarnessIcon harness={harness} loading={status === 'running'} testId={testId} />
      <AgentStatusIcon status={status} surface={surface} className="absolute right-0 bottom-0" />
    </span>
  )
}
