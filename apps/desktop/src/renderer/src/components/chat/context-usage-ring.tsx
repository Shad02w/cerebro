import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AgentContextUsage, AgentHarness } from '@cerebro/core'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  contextUsageView,
  type ContextUsageRow,
  type ContextUsageSegment,
  type ContextUsageSwatch
} from './context-usage-view'

const radius = 6
const circumference = 2 * Math.PI * radius
const hatch = 'repeating-linear-gradient(-45deg, transparent 0 1.5px, rgba(0,0,0,0.55) 1.5px 2.5px)'

const ringColor = (percentage: number | null): string =>
  percentage == null
    ? 'text-muted-foreground'
    : percentage >= 90
      ? 'text-destructive'
      : percentage >= 75
        ? 'text-amber-500'
        : 'text-muted-foreground'

const swatchStyle = (color: string, swatch: ContextUsageSwatch): React.CSSProperties => {
  if (swatch === 'hollow') return { boxShadow: `inset 0 0 0 1.5px ${color}` }
  if (swatch === 'hatch') return { backgroundColor: color, backgroundImage: hatch }
  return { backgroundColor: color }
}

function UsageRow({
  row,
  indent = false
}: {
  row: ContextUsageRow
  indent?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const nested = row.children.length ? (
    <ul className="flex flex-col">
      {row.children.map((child) => (
        <UsageRow key={child.id} row={child} indent />
      ))}
    </ul>
  ) : null
  const body = (
    <>
      <span
        className="size-2 shrink-0 rounded-full"
        style={swatchStyle(row.color, row.swatch)}
        data-color={row.color}
        data-swatch={row.swatch}
      />
      <span className="flex min-w-0 items-center gap-1">
        {row.expandable ? (
          <ChevronRight
            className={cn('size-3 shrink-0 text-muted-foreground', open && 'rotate-90')}
            aria-hidden="true"
          />
        ) : null}
        <span className="truncate">{row.label}</span>
      </span>
      <span className="text-right text-muted-foreground tabular-nums">{row.tokensLabel}</span>
      <span className="text-right text-muted-foreground tabular-nums">
        {row.percentLabel ?? '—'}
      </span>
    </>
  )
  const className = cn(
    'grid w-full grid-cols-[0.5rem_1fr_auto_3.25rem] items-center gap-x-2 px-2 py-1 text-left',
    indent && 'pl-7'
  )
  return (
    <li data-testid="context-usage-row" data-slice={row.id}>
      {row.expandable ? (
        <button
          type="button"
          className={className}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
      {row.expandable ? (open ? nested : null) : nested}
    </li>
  )
}

function UsageBar({
  segments,
  windowTokens
}: {
  segments: ContextUsageSegment[]
  windowTokens: number
}): React.JSX.Element {
  return (
    <div
      className="mx-2 mt-1 mb-1 flex h-2 overflow-hidden rounded-full bg-[#3f3f46]"
      data-testid="context-usage-bar"
      aria-hidden="true"
    >
      {segments.map((segment) => (
        <span
          key={segment.id}
          data-testid="context-usage-segment"
          data-slice={segment.id}
          data-tokens={segment.tokens}
          className="h-full shrink-0"
          style={{
            width: windowTokens > 0 ? `${(segment.tokens / windowTokens) * 100}%` : 0,
            backgroundColor: segment.color,
            ...(segment.hatch ? { backgroundImage: hatch } : {})
          }}
        />
      ))}
    </div>
  )
}

export function ContextUsageRing({
  usage,
  harness,
  modelLabel
}: {
  usage?: AgentContextUsage
  harness?: AgentHarness
  modelLabel?: string
}): React.JSX.Element | null {
  if (!usage) return null
  const view = contextUsageView(usage, { harness, modelLabel })
  const percentage = view.ringPercent
  const offset = circumference * (1 - (percentage ?? 0) / 100)
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        data-testid="context-usage-ring"
        aria-label={
          percentage == null
            ? 'Context usage, nothing to report yet'
            : `${percentage}% of context used`
        }
        className={cn(
          'flex shrink-0 items-center rounded-md p-1 text-xs outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted',
          ringColor(percentage)
        )}
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
          {percentage == null ? null : (
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
          )}
        </svg>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        positionerClassName="z-[80]"
        className="z-[80] w-96 bg-popover p-1.5 text-xs text-popover-foreground data-starting-style:opacity-100!"
        data-testid="context-usage-popover"
      >
        <div className="px-2 pt-1.5 pb-1">
          <p className="text-muted-foreground">{view.title}</p>
          <p className="mt-0.5 font-medium">{view.headline}</p>
          <p className="mt-0.5 text-muted-foreground tabular-nums">{view.summary}</p>
        </div>
        {view.bar ? <UsageBar segments={view.bar} windowTokens={usage.contextWindow} /> : null}
        {view.sections.map((group) => (
          <section key={group.id}>
            {group.label ? (
              <p className="px-2 pt-2 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
                {group.label}
              </p>
            ) : null}
            <ul aria-label={group.label || 'Context usage'} className="flex flex-col">
              {group.rows.map((row) => (
                <UsageRow key={row.id} row={row} />
              ))}
            </ul>
          </section>
        ))}
        {view.note ? (
          <p className="px-2 pt-2 pb-1 leading-snug text-muted-foreground">{view.note}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
