import { LoaderCircle } from 'lucide-react'
import type { AgentSubagent, AgentSubagentTokens } from '@cerebro/core'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChatSessionChip } from './chat-session-chip'

const finished = (status: AgentSubagent['status']): boolean =>
  status === 'completed' || status === 'failed' || status === 'stopped'

function grouped(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Elapsed time for a finished row. Hours drop the seconds. */
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
      ? ` (${grouped(input)} in, ${grouped(output)} out)`
      : ''
  return `${grouped(shown)}${split}`
}

function elapsed(agent: AgentSubagent): string {
  if (!finished(agent.status) || agent.startedAt === undefined || agent.finishedAt === undefined)
    return ''
  return formatSubagentElapsed(agent.finishedAt - agent.startedAt)
}

export function ChatSubagents({
  agents
}: {
  agents: AgentSubagent[] | undefined
}): React.JSX.Element | null {
  if (!agents?.length) return null
  return (
    <Popover>
      <PopoverTrigger
        render={
          <ChatSessionChip
            label="Sub-agent"
            aria-label={`${agents.length} ${agents.length === 1 ? 'sub-agent' : 'sub-agents'}`}
            data-testid="chat-subagent-chip"
          />
        }
      />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        positionerClassName="z-[80]"
        className="z-[80] w-[28rem] bg-popover p-1.5 data-starting-style:opacity-100!"
        data-testid="chat-subagents"
      >
        <div
          aria-label="Sub-agents"
          className="grid grid-cols-[0.875rem_minmax(9rem,1fr)_3.5rem_max-content] items-center gap-x-3 gap-y-1 px-2 py-1"
        >
          <span />
          <span />
          <span className="text-xs text-muted-foreground">Elapsed</span>
          <span className="text-right text-xs text-muted-foreground">Tokens</span>
          {agents.map((agent) => {
            const live = !finished(agent.status)
            return (
              <div
                key={agent.id}
                className="contents"
                data-testid="chat-subagent"
                data-status={agent.status}
              >
                <span data-cell="" className="flex size-3.5 items-center justify-center">
                  {live ? (
                    <LoaderCircle
                      className="size-3.5 animate-spin text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <span
                      className="size-1.5 rounded-full bg-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span
                  data-cell=""
                  className="min-w-0 truncate text-xs"
                  title={agent.title || agent.id}
                >
                  {agent.title || agent.id}
                </span>
                <span data-cell="" className="text-xs text-muted-foreground tabular-nums">
                  {elapsed(agent)}
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
