import { X, Zap } from 'lucide-react'
import type { AgentSession } from '@cerebro/core'
import { Button } from '@/components/ui/button'

export function ChatQueue({
  session,
  onSteer,
  onDequeue
}: {
  session: AgentSession
  onSteer: (commandId: string) => void
  onDequeue: (commandId: string) => void
}): React.JSX.Element | null {
  if (!session.queue?.length) return null
  return (
    <ul
      className="flex flex-col gap-1.5 px-2 pb-2"
      aria-label="Queued messages"
      data-testid="chat-queue"
    >
      {session.queue.map((item) => {
        const steerable =
          item.model.key === session.model.key &&
          (item.accessMode ?? 'full') === (session.accessMode ?? 'full')
        return (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3 text-xs"
            data-testid="chat-queue-item"
          >
            <span className="min-w-0 flex-1 truncate">{item.text}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!steerable}
              title={
                steerable
                  ? 'Fold this message into the current response now'
                  : 'Queued with a different model or access mode. Remove it and resend, or let it send automatically after this response.'
              }
              onClick={() => onSteer(item.id)}
            >
              <Zap className="size-3.5" aria-hidden="true" />
              Steer
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Remove queued message"
              title="Remove"
              onClick={() => onDequeue(item.id)}
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
