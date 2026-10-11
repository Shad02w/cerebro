import type { AgentSession } from '@cerebro/core'
import { ChatBackgroundTasks } from './chat-background-tasks'

/** Status chips for the session. Renders nothing until one of them has something to show. */
export function ChatSessionChips({ session }: { session: AgentSession }): React.JSX.Element | null {
  if (!session.background?.length) return null
  return (
    <div
      role="toolbar"
      aria-label="Session status"
      className="flex flex-wrap items-center gap-2 px-2 pb-2"
      data-testid="chat-session-chips"
    >
      <ChatBackgroundTasks tasks={session.background} />
    </div>
  )
}
