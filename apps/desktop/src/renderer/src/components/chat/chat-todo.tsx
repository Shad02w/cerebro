import { Check, Circle, CircleDot } from 'lucide-react'
import type { TodoSnapshot, TodoStatus } from '@cerebro/core'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ChatSessionChip } from './chat-session-chip'

const marks: Record<TodoStatus, { icon: typeof Circle; tone: string }> = {
  pending: { icon: Circle, tone: 'text-muted-foreground' },
  in_progress: { icon: CircleDot, tone: 'text-foreground' },
  completed: { icon: Check, tone: 'text-muted-foreground' }
}

/** Checklist rows. An empty list renders nothing. */
export function ChatTodoList({
  todo
}: {
  todo: TodoSnapshot | undefined
}): React.JSX.Element | null {
  if (!todo?.items.length) return null
  const completed = todo.items.filter((item) => item.status === 'completed').length
  const total = todo.items.length
  return (
    <div data-testid="chat-todo-list">
      <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
        Tasks <span className="tabular-nums">{`${completed}/${total}`}</span>
      </p>
      <ol aria-label="Tasks" className="flex flex-col">
        {todo.items.map((item) => {
          const mark = marks[item.status]
          const Icon = mark.icon
          const phrase = item.status === 'in_progress' ? item.activeLabel : undefined
          return (
            <li
              key={item.id}
              data-testid="chat-todo-item"
              data-status={item.status}
              className="flex items-start gap-2 rounded-sm px-2 py-1.5 text-xs"
            >
              <Icon className={cn('mt-0.5 size-3.5 shrink-0', mark.tone)} aria-hidden="true" />
              <span className="min-w-0">
                <span
                  className={
                    item.status === 'completed' ? 'text-muted-foreground line-through' : undefined
                  }
                >
                  {item.label}
                </span>
                {phrase ? <span className="ml-2 text-muted-foreground">{phrase}</span> : null}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The session checklist, on the same row as background jobs. An empty list hides the button. */
export function ChatTodo({ todo }: { todo: TodoSnapshot | undefined }): React.JSX.Element | null {
  if (!todo?.items.length) return null
  const total = todo.items.length
  return (
    <Popover>
      <PopoverTrigger
        render={
          <ChatSessionChip
            label="Tasks"
            count={total}
            aria-label={`${total} ${total === 1 ? 'task' : 'tasks'}`}
            data-testid="chat-todo-chip"
          />
        }
      />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        positionerClassName="z-[80]"
        className="z-[80] w-80 bg-popover p-1.5 data-starting-style:opacity-100!"
        data-testid="chat-todo"
      >
        <div className="max-h-64 overflow-y-auto">
          <ChatTodoList todo={todo} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
