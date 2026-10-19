import { useEffect, useState } from 'react'
import {
  compactTokenCount,
  formatAgentElapsed,
  type AgentSubagent,
  type AgentSubagentTokens
} from '@cerebro/core'
import { AgentStatusIcon } from '@/components/agent-status-icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChatSessionChip } from './chat-session-chip'

const finished = (status: AgentSubagent['status']): boolean =>
  status === 'completed' || status === 'failed' || status === 'stopped'

const liveStatus = (status: AgentSubagent['status']): boolean =>
  status === 'created' || status === 'running'

/** Running and not-yet-started children. The session badge counts these, not finished runs. */
function liveAgentCount(agents: AgentSubagent[]): number {
  return agents.filter((agent) => liveStatus(agent.status)).length
}

function statusMark(
  status: AgentSubagent['status']
): 'running' | 'finished' | 'failed' | 'interrupted' {
  if (status === 'failed') return 'failed'
  if (status === 'stopped') return 'interrupted'
  if (status === 'completed') return 'finished'
  return 'running'
}

function statusWord(status: AgentSubagent['status']): string {
  if (status === 'failed') return 'Failed'
  if (status === 'stopped') return 'Stopped'
  if (status === 'completed') return 'Done'
  return 'Running'
}

function byStatus(agents: AgentSubagent[]): AgentSubagent[] {
  const rank = (status: AgentSubagent['status']): number =>
    liveStatus(status) ? 0 : status === 'completed' ? 1 : status === 'failed' ? 2 : 3
  return agents.toSorted((a, b) => rank(a.status) - rank(b.status))
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
      ? ` (${compactTokenCount(input)} in, ${compactTokenCount(output)} out)`
      : ''
  return `${compactTokenCount(shown)}${split}`
}

/**
 * Created rows have no elapsed. A harness duration replaces a local tick. Otherwise a running
 * row ticks from startedAt, and a finished row uses finishedAt - startedAt.
 */
function elapsed(agent: AgentSubagent, now: number): string {
  if (agent.status === 'created') return ''
  if (agent.durationMs !== undefined) return formatAgentElapsed(agent.durationMs)
  if (finished(agent.status)) {
    if (agent.startedAt === undefined || agent.finishedAt === undefined) return ''
    return formatAgentElapsed(agent.finishedAt - agent.startedAt)
  }
  if (agent.startedAt === undefined) return ''
  return formatAgentElapsed(now - agent.startedAt)
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

function useSubagentNow(agents: AgentSubagent[]): number {
  const ticking = needsClock(agents)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const refresh = (): void => setNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => window.clearInterval(timer)
  }, [ticking])
  return now
}

/** Child agents in the popover grid. */
function settledLabel(agent: AgentSubagent): string {
  const tokens = formatSubagentTokens(agent.tokens)
  return tokens === 'no tokens'
    ? statusWord(agent.status)
    : `${statusWord(agent.status)} · ${tokens}`
}

export function ChatSubagentList({ agents }: { agents: AgentSubagent[] }): React.JSX.Element {
  const now = useSubagentNow(agents)
  return (
    <div
      aria-label="Agents"
      className="grid grid-cols-[0.875rem_minmax(0,12rem)_auto_auto_auto] items-center gap-x-3 gap-y-1 px-2 py-1"
    >
      {byStatus(agents).map((agent) => {
        const live = !finished(agent.status)
        return (
          <div
            key={agent.id}
            className="contents"
            data-testid="chat-subagent"
            data-status={agent.status}
          >
            <span data-cell="" className="flex size-3.5 items-center justify-center">
              <AgentStatusIcon status={statusMark(agent.status)} />
            </span>
            <span data-cell="" className="min-w-0 truncate text-xs" title={agent.title || agent.id}>
              {agent.title || agent.id}
            </span>
            <span data-cell="" className="text-xs text-muted-foreground">
              {reportedIdentity(agent)}
            </span>
            <span data-cell="" className="text-xs text-muted-foreground tabular-nums">
              {elapsed(agent, now)}
            </span>
            <span data-cell="" className="text-right text-xs text-muted-foreground tabular-nums">
              {live ? statusWord(agent.status) : settledLabel(agent)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Child agents stacked for the side column, where the popover grid is too wide. */
function SubagentStackGroup({
  label,
  agents,
  now
}: {
  label: string
  agents: AgentSubagent[]
  now: number
}): React.JSX.Element | null {
  if (!agents.length) return null
  return (
    <>
      <li className="px-2 pt-1 text-[11px] text-muted-foreground">{label}</li>
      {agents.map((agent) => {
        const live = !finished(agent.status)
        const identity = reportedIdentity(agent)
        const time = elapsed(agent, now)
        return (
          <li
            key={agent.id}
            data-testid="chat-subagent"
            data-status={agent.status}
            className="flex items-start gap-2 rounded-sm px-2 py-1.5 text-xs"
          >
            <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
              <AgentStatusIcon status={statusMark(agent.status)} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={agent.title || agent.id}>
                {agent.title || agent.id}
              </span>
              {identity ? (
                <span className="block truncate text-muted-foreground">{identity}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-right text-muted-foreground tabular-nums">
              {time ? <span className="block">{time}</span> : null}
              <span className="block">{statusWord(agent.status)}</span>
              {live ? null : <span className="block">{formatSubagentTokens(agent.tokens)}</span>}
            </span>
          </li>
        )
      })}
    </>
  )
}

export function ChatSubagentStack({ agents }: { agents: AgentSubagent[] }): React.JSX.Element {
  const ordered = byStatus(agents)
  const now = useSubagentNow(ordered)
  const running = ordered.filter((agent) => !finished(agent.status))
  const settled = ordered.filter((agent) => finished(agent.status))
  return (
    <ul aria-label="Agents" className="flex flex-col">
      <SubagentStackGroup label="Running" agents={running} now={now} />
      <SubagentStackGroup label="Done" agents={settled} now={now} />
    </ul>
  )
}

export function ChatSubagents({
  agents
}: {
  agents: AgentSubagent[] | undefined
}): React.JSX.Element | null {
  const listed = agents ?? []
  if (!listed.length) return null
  const running = liveAgentCount(listed)
  const ariaLabel =
    running > 0
      ? `${running} running`
      : `${listed.length} ${listed.length === 1 ? 'agent' : 'agents'}`
  return (
    <Popover>
      <PopoverTrigger
        render={
          <ChatSessionChip label="Agents" aria-label={ariaLabel} data-testid="chat-subagent-chip" />
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
        <ChatSubagentList agents={listed} />
      </PopoverContent>
    </Popover>
  )
}
