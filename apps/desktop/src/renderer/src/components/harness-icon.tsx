import type { AgentActivityStatus, AgentHarness } from '@cerebro/core'
import claudeIcon from '@/assets/agents/claude.svg'
import codexIcon from '@/assets/agents/codex.svg'
import piIcon from '@/assets/agents/pi.svg'
import { AgentStatusIcon } from '@/components/agent-status-icon'
import { harnessLabels } from '@/components/chat/queries'
import { cn } from '@/lib/utils'

const icons: Record<AgentHarness, string> = {
  claude: claudeIcon,
  codex: codexIcon,
  pi: piIcon
}

/** Masked harness logo, the same form as the agent tab title icon. */
export function HarnessIcon({
  harness,
  testId,
  className
}: {
  harness: AgentHarness
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
        'size-4 bg-current [mask-repeat:no-repeat] [mask-position:center] [mask-size:contain]',
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
  testId,
  plateClassName
}: {
  harness: AgentHarness
  status: AgentActivityStatus
  surface: 'sidebar' | 'tab'
  testId?: string
  plateClassName: string
}): React.JSX.Element {
  return (
    <span className="relative inline-flex size-4 shrink-0" data-agent-harness={harness}>
      <HarnessIcon harness={harness} testId={testId} />
      <AgentStatusIcon
        status={status}
        surface={surface}
        className={cn('absolute -right-1 -bottom-1 rounded-[3px] p-px', plateClassName)}
      />
    </span>
  )
}
