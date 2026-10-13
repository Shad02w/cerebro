import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ChatTurnSummary } from './chat-turns'

function TurnMarker({
  turn,
  index,
  active,
  onSelect
}: {
  turn: ChatTurnSummary
  index: number
  active: boolean
  onSelect: (turnId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const title = turn.prompt || 'Message'
  return (
    <li>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          data-testid="chat-turn-marker"
          data-turn-id={turn.turnId}
          data-active={active ? 'true' : 'false'}
          data-open={open ? 'true' : 'false'}
          aria-current={active ? 'true' : undefined}
          aria-label={`Go to turn ${index + 1}: ${title}`}
          className="flex h-1.5 w-6 items-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={() => onSelect(turn.turnId)}
        >
          <span
            aria-hidden
            data-testid="chat-turn-bar"
            className={cn(
              'block rounded-full transition-all duration-150 ease-out motion-reduce:transition-none',
              active ? 'h-0.5 w-3.5 bg-foreground/80' : 'h-0.5 w-3 bg-muted-foreground/45',
              open && 'h-1 w-5 bg-foreground'
            )}
          />
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          initialFocus={false}
          finalFocus={false}
          data-testid="chat-turn-popover"
          className="pointer-events-none w-72 p-3"
        >
          <p className="line-clamp-3 text-sm font-medium break-words text-foreground">{title}</p>
          {turn.finished && turn.response ? (
            <p className="mt-1.5 line-clamp-4 text-xs break-words text-muted-foreground">
              {turn.response}
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    </li>
  )
}

/** Floating scroll spy of session turns. Hidden until the session has more than one turn. */
export function ChatTurnRail({
  turns,
  activeTurnId,
  onSelect
}: {
  turns: readonly ChatTurnSummary[]
  activeTurnId: string | null
  onSelect: (turnId: string) => void
}): React.JSX.Element | null {
  if (turns.length < 2) return null
  return (
    <nav
      aria-label="Conversation turns"
      data-testid="chat-turn-rail"
      className="pointer-events-auto absolute top-1/2 left-2 z-20 -translate-y-1/2"
    >
      <ol className="flex flex-col items-start gap-px">
        {turns.map((turn, index) => (
          <TurnMarker
            key={turn.turnId}
            turn={turn}
            index={index}
            active={turn.turnId === activeTurnId}
            onSelect={onSelect}
          />
        ))}
      </ol>
    </nav>
  )
}
