import type { AgentContextUsage } from '@cerebro/core'

const radius = 6
const circumference = 2 * Math.PI * radius

const effortLabel = (effort: string): string =>
  effort.length ? effort[0].toUpperCase() + effort.slice(1) : effort

const ringColor = (percentage: number): string =>
  percentage >= 90
    ? 'text-destructive'
    : percentage >= 75
      ? 'text-amber-500'
      : 'text-muted-foreground'

export function ContextUsageRing({
  usage,
  effort
}: {
  usage?: AgentContextUsage
  effort?: string
}): React.JSX.Element | null {
  if (!usage) return null
  const percentage = Math.min(100, Math.max(0, Math.round(usage.percentage)))
  const offset = circumference * (1 - percentage / 100)
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 rounded p-1 text-xs ${ringColor(percentage)}`}
      title={`${usage.usedTokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens (${percentage}% of context used)`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 7 7)"
        />
      </svg>
      <span>
        {percentage}%{effort ? ` · ${effortLabel(effort)}` : ''}
      </span>
    </div>
  )
}
