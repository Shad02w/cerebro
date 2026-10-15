import { useEffect, useState } from 'react'
import type { AgentSubagent, AgentSubagentTokens } from '@cerebro/core'
import { AgentStatusIcon } from '@/components/agent-status-icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChatSessionChip } from './chat-session-chip'

const finished = (status: AgentSubagent['status']): boolean =>
  status === 'completed' || status === 'failed' || status === 'stopped'

/** Compact token count. Under 1000 stays whole. Thousands and millions use one decimal, dropped when the unit is round. */
function compactCount(value: number): string {
  const negative = value < 0
  const abs = Math.abs(value)
  if (!Number.isFinite(abs)) return '0'
  if (abs < 1000) return `${negative ? '-' : ''}${Math.round(abs)}`
  const scaled = (scale: number, suffix: 'k' | 'm'): string => {
    const tenths = Math.round((abs / scale) * 10)
    const whole = Math.trunc(tenths / 10)
    const frac = Math.abs(tenths % 10)
    const body = frac === 0 ? `${whole}` : `${whole}.${frac}`
    return `${negative ? '-' : ''}${body}${suffix}`
  }
  if (abs >= 999_950) return scaled(1_000_000, 'm')
  return scaled(1_000, 'k')
}

/** Elapsed time. Hours drop the seconds. */
function formatSubagentElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${rest}s`
  return `${rest}s`
}

/** Token cell. Absent counts say so. Zero is a real count. */
function formatSubagentTokens(tokens: AgentSubagentTokens | undefined): string {
  if (!tokens) return 'no tokens'
  const { input, output, total } = tokens
  if (input === undefined && output === undefined && total === undefined) return 'no tokens'
  const shown =
    total ?? (input !== undefined && output !== undefined ? input + output : (input ?? output ?? 0))
  const split =
    input !== undefined && output !== undefined
      ? ` (${compactCount(input)} in, ${compactCount(output)} out)`
      : ''
  return `${compactCount(shown)}${split}`
}

/**
 * Created rows have no elapsed. A harness duration replaces a local tick. Otherwise a running
 * row ticks from startedAt, and a finished row uses finishedAt - startedAt.
 */
function elapsed(agent: AgentSubagent, now: number): string {
  if (agent.status === 'created') return ''
  if (agent.durationMs !== undefined) return formatSubagentElapsed(agent.durationMs)
  if (finished(agent.status)) {
    if (agent.startedAt === undefined || agent.finishedAt === undefined) return ''
    return formatSubagentElapsed(agent.finishedAt - agent.startedAt)
  }
  if (agent.startedAt === undefined) return ''
  return formatSubagentElapsed(now - agent.startedAt)
}

/** Model and effort the harness sent for this child. Either one is left out when it was not sent. */
function reportedIdentity(agent: AgentSubagent): string {
  return [agent.model, agent.effort]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

function needsClock(agents: AgentSubagent[]): boolean {
  return agents.some(
    (agent) =>
      agent.status === 'running' && agent.durationMs === undefined && agent.startedAt !== undefined
  )
}

export function ChatSubagents({
  agents
}: {
  agents: AgentSubagent[] | undefined
}): React.JSX.Element | null {
  const listed = agents ?? []
  const ticking = needsClock(listed)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const refresh = (): void => setNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => window.clearInterval(timer)
  }, [ticking])
  if (!listed.length) return null
  return (
    <Popover>
      <PopoverTrigger
        render={
          <ChatSessionChip
            label="Agents"
            aria-label={`${listed.length} ${listed.length === 1 ? 'agent' : 'agents'}`}
            data-testid="chat-subagent-chip"
          />
        }
      />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        positionerClassName="z-[80]"
        className="z-[80] w-max max-w-[24rem] bg-popover p-1.5 data-starting-style:opacity-100!"
        data-testid="chat-subagents"
      >
        <div
          aria-label="Agents"
          className="grid grid-cols-[0.875rem_minmax(0,12rem)_auto_auto_auto] items-center gap-x-3 gap-y-1 px-2 py-1"
        >
          {listed.map((agent) => {
            const live = !finished(agent.status)
            return (
              <div
                key={agent.id}
                className="contents"
                data-testid="chat-subagent"
                data-status={agent.status}
              >
                <span data-cell="" className="flex size-3.5 items-center justify-center">
                  <AgentStatusIcon status={live ? 'running' : 'finished'} />
                </span>
                <span
                  data-cell=""
                  className="min-w-0 truncate text-xs"
                  title={agent.title || agent.id}
                >
                  {agent.title || agent.id}
                </span>
                <span data-cell="" className="text-xs text-muted-foreground">
                  {reportedIdentity(agent)}
                </span>
                <span data-cell="" className="text-xs text-muted-foreground tabular-nums">
                  {elapsed(agent, now)}
                </span>
                <span
                  data-cell=""
                  className="text-right text-xs text-muted-foreground tabular-nums"
                >
                  {live ? '' : formatSubagentTokens(agent.tokens)}
                </span>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
