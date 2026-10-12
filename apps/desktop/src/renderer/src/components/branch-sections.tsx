import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { sectionAge, workspaceSections, type ThreadRow } from '@cerebro/core'
import { HarnessIcon } from '@/components/harness-icon'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** Search control for one branch. Closed rows reopen; open rows focus the pane. */
export function BranchSections({
  workspaceId,
  branch,
  rows,
  onOpen,
  className
}: {
  workspaceId: number
  branch: string
  rows: readonly ThreadRow[]
  onOpen: (row: ThreadRow) => void
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [now, setNow] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const matches = workspaceSections(rows, workspaceId, query)
  const index = matches.length === 0 ? 0 : Math.min(cursor, matches.length - 1)

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const choose = (row: ThreadRow): void => {
    onOpen(row)
    setOpen(false)
  }

  return (
    <span className={cn('z-10', className)}>
      <Popover
        open={open}
        onOpenChange={(next): void => {
          setOpen(next)
          if (next) setNow(Date.now())
          else {
            setQuery('')
            setCursor(0)
          }
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              className="app-no-drag flex size-5 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
              data-testid={`branch-sections-${workspaceId}`}
              aria-label={`Sections on ${branch}`}
              onClick={(event): void => event.stopPropagation()}
              onPointerDown={(event): void => event.stopPropagation()}
            />
          }
        >
          <Search className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="right"
          sideOffset={8}
          className="w-80 p-3"
          data-testid={`branch-sections-panel-${workspaceId}`}
        >
          <p className="px-1 pb-2 text-sm font-medium">Sections on {branch}</p>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={input}
              aria-label={`Search sections on ${branch}`}
              placeholder="Search sections"
              value={query}
              data-testid={`branch-sections-search-${workspaceId}`}
              className="h-8 pr-2 pl-8 text-xs shadow-none md:text-xs"
              onChange={(event): void => {
                setQuery(event.target.value)
                setCursor(0)
              }}
              onKeyDown={(event): void => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setCursor((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setCursor((current) => Math.max(current - 1, 0))
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  const row = matches[index]
                  if (row) choose(row)
                }
              }}
            />
          </div>
          {matches.length === 0 ? (
            <p className="px-1 py-3 text-xs text-muted-foreground">
              No earlier sections on this branch.
            </p>
          ) : (
            <ul className="mt-2 flex max-h-64 flex-col gap-0.5 overflow-auto" role="listbox">
              {matches.map((row, rowIndex) => (
                <li key={row.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={rowIndex === index}
                    className={cn(
                      'flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left',
                      rowIndex === index && 'bg-accent text-accent-foreground'
                    )}
                    data-testid={`branch-section-${row.id}`}
                    data-section-state={row.open ? 'open' : 'closed'}
                    onMouseEnter={(): void => setCursor(rowIndex)}
                    onClick={(): void => choose(row)}
                  >
                    <HarnessIcon harness={row.harness} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{row.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {row.open ? 'Open' : `Closed · ${sectionAge(row.updatedAt, now)}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="px-1 pt-2 text-[11px] text-muted-foreground">
            Enter reopens the closed section on this branch.
          </p>
        </PopoverContent>
      </Popover>
    </span>
  )
}

/** Status-search hits under one workspace. Choosing a closed row reopens it. */
export function SectionHitList({
  workspaceId,
  rows,
  onOpen
}: {
  workspaceId: number
  rows: readonly ThreadRow[]
  onOpen: (row: ThreadRow) => void
}): React.JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <ul
      className="flex min-w-0 flex-col gap-0.5 py-0.5 pr-2 pl-8"
      data-testid={`status-sections-${workspaceId}`}
    >
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            className="app-no-drag flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent"
            data-testid={`status-section-${row.id}`}
            data-section-state={row.open ? 'open' : 'closed'}
            onClick={(): void => onOpen(row)}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <HarnessIcon harness={row.harness} />
              <span className="min-w-0 flex-1 truncate text-xs">{row.title}</span>
            </span>
            <span className="pl-5 text-[11px] text-sidebar-foreground/60">
              {row.open ? 'Open' : 'Closed · reopen'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
