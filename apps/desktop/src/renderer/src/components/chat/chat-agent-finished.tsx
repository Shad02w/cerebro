import type { AgentSubagent } from '@cerebro/core'
import { AgentStatusIcon } from '@/components/agent-status-icon'

/** The tab mark for a child that has finished. Completed uses the green done dot. */
function finishedMark(status: AgentSubagent['status']): 'finished' | 'failed' | 'interrupted' {
  if (status === 'failed') return 'failed'
  if (status === 'stopped') return 'interrupted'
  return 'finished'
}

/** One line in the chat flow for a child whose end arrived on the stream. */
export function ChatAgentFinished({
  agent,
  text
}: {
  agent: AgentSubagent
  text: string
}): React.JSX.Element {
  return (
    <div
      className="flex items-start gap-2 text-xs text-muted-foreground"
      data-testid="chat-agent-finished"
      data-agent-status={agent.status}
    >
      <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
        <AgentStatusIcon status={finishedMark(agent.status)} />
      </span>
      <span className="min-w-0 flex-1 break-words">{text}</span>
    </div>
  )
}
