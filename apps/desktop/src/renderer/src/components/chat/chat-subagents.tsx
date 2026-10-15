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
