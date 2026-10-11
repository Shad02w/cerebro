import { LoaderCircle } from 'lucide-react'
import type { AgentBackgroundTask } from '@cerebro/core'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChatSessionChip } from './chat-session-chip'

export function ChatBackgroundTasks({
  tasks
}: {
  tasks: AgentBackgroundTask[] | undefined
}): React.JSX.Element | null {
  if (!tasks?.length) return null
  return (
    <Popover>
      <PopoverTrigger
        render={
          <ChatSessionChip
            label="Background"
            count={tasks.length}
            aria-label={`${tasks.length} background ${tasks.length === 1 ? 'job' : 'jobs'}`}
            data-testid="chat-background-chip"
          />
        }
      />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        positionerClassName="z-[80]"
        className="z-[80] w-80 bg-popover p-1.5 data-starting-style:opacity-100!"
        data-testid="chat-background-tasks"
      >
        <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
          Running until they finish or this agent closes
        </p>
        <ul aria-label="Background jobs" className="flex max-h-64 flex-col overflow-y-auto">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs"
              data-testid="chat-background-task"
            >
              <LoaderCircle
                className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate" title={task.title}>
                {task.title || 'Background job'}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
