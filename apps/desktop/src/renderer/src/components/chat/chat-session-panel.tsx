import type { AgentSession } from '@cerebro/core'
import { ChatBackgroundTaskList } from './chat-background-tasks'
import { ChatSubagentStack } from './chat-subagents'
import { ChatTodoList } from './chat-todo'

/**
 * Tasks, background jobs, and agents beside the transcript.
 * ChatView is the `@container/chat` element, so this follows the pane width.
 * At 56rem the column is shown; a narrower pane keeps the chips above the composer.
 */
export function ChatSessionPanel({ session }: { session: AgentSession }): React.JSX.Element | null {
  const todo = session.todo?.items.length ? session.todo : undefined
  const tasks = session.background?.length ? session.background : undefined
  const agents = session.subagents?.length ? session.subagents : undefined
  if (!todo && !tasks && !agents) return null
  return (
    <aside
      data-testid="chat-session-panel"
      aria-label="Session status"
      className="hidden h-full min-h-0 w-80 shrink-0 flex-col overflow-y-auto overscroll-y-contain border-l bg-background pt-8 @min-[56rem]/chat:flex"
    >
      {todo ? (
        <section
          data-testid="chat-session-panel-tasks"
          className="border-b px-1 py-2 last:border-b-0"
        >
          <ChatTodoList todo={todo} />
        </section>
      ) : null}
      {tasks ? (
        <section
          data-testid="chat-session-panel-background"
          className="border-b px-1 py-2 last:border-b-0"
        >
          <h2 className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">Background</h2>
          <ChatBackgroundTaskList tasks={tasks} />
        </section>
      ) : null}
      {agents ? (
        <section
          data-testid="chat-session-panel-agents"
          className="border-b px-1 py-2 last:border-b-0"
        >
          <h2 className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">Agents</h2>
          <ChatSubagentStack agents={agents} />
        </section>
      ) : null}
    </aside>
  )
}
