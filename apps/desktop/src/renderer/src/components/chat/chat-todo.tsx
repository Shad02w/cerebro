import { Check, Circle, CircleDot } from 'lucide-react'
import type { TodoSnapshot, TodoStatus } from '@cerebro/core'
import { cn } from '@/lib/utils'

const marks: Record<TodoStatus, { icon: typeof Circle; tone: string }> = {
  pending: { icon: Circle, tone: 'text-muted-foreground' },
  in_progress: { icon: CircleDot, tone: 'text-foreground' },
  completed: { icon: Check, tone: 'text-muted-foreground' }
}

/** The session checklist, above the composer. An empty list clears the card. */
export function ChatTodo({ todo }: { todo: TodoSnapshot | undefined }): React.JSX.Element | null {
  if (!todo?.items.length) return null
  const completed = todo.items.filter((item) => item.status === 'completed').length
  return (
    <section
      aria-label={`Tasks, ${completed} of ${todo.items.length} complete`}
      data-testid="chat-todo"
      className="mb-2 rounded-xl border bg-muted/20 px-3 py-2.5"
    >
      <p className="mb-1.5 text-xs text-muted-foreground">
        Tasks <span className="tabular-nums">{`${completed}/${todo.items.length}`}</span>
      </p>
      <ol className="flex flex-col gap-1">
        {todo.items.map((item) => {
          const mark = marks[item.status]
          const Icon = mark.icon
          const phrase = item.status === 'in_progress' ? item.activeLabel : undefined
          return (
            <li
              key={item.id}
              data-testid="chat-todo-item"
              data-status={item.status}
              className="flex items-start gap-2 text-sm"
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
    </section>
  )
}
