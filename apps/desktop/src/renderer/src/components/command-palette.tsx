import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, GitBranch, History, Search } from 'lucide-react'
import type { ChatSearchHit } from '@cerebro/core'
import type { Project, Workspace } from '@shared/types'
import { harnessLabels } from '@/components/chat/queries'
import { HarnessIcon, HarnessStatusIcon } from '@/components/harness-icon'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ShortcutKbd, useKeybindBinding } from '@/keybinds'
import { relativeUpdated } from '@/lib/agent-status-text'
import {
  PALETTE_FILTERS,
  PALETTE_GROUP_LABELS,
  buildPaletteGroups,
  highlightParts,
  nextPaletteFilter,
  workspaceRowLabel,
  type PaletteFilter,
  type PaletteGroup,
  type PaletteRow
} from '@/lib/command-palette'
import { sessionWorkspaceLine } from '@/lib/session-workspace-line'
import { cn } from '@/lib/utils'

export type { PaletteRow } from '@/lib/command-palette'

const FILTER_LABELS: Record<PaletteFilter, string> = { all: 'All', ...PALETTE_GROUP_LABELS }

const WORKSPACE_KIND_LABELS = {
  default: 'Default branch',
  worktree: 'Worktree',
  directory: 'Directory'
} as const

/** Closed-session (history) rows read amber in both themes. */
const historyText = 'text-amber-600 dark:text-amber-300'

const footKbdClass =
  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-foreground/15 bg-muted px-1 font-sans text-[10.5px] leading-none text-foreground'

function located(
  projects: Project[],
  workspaceId: number | null
): { project: Project; workspace: Workspace } | null {
  if (workspaceId == null) return null
  for (const project of projects) {
    const workspace = project.workspaces.find((item) => item.id === workspaceId)
    if (workspace) return { project, workspace }
  }
  return null
}

function moveHighlight(key: string, highlight: number, count: number): number | null {
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null
  if (!count) return highlight
  const next = key === 'ArrowDown' ? highlight + 1 : highlight - 1
  return (next + count) % count
}

export function CommandPalette({
  open,
  projects,
  activeWorkspaceId,
  onChoose,
  onClose
}: {
  open: boolean
  projects: Project[]
  activeWorkspaceId: number | null
  /** Resolves once the choice is shown. A rejection keeps the palette open with the error. */
  onChoose: (row: PaletteRow) => Promise<void> | void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {open ? (
        <CommandPalettePanel
          projects={projects}
          activeWorkspaceId={activeWorkspaceId}
          onChoose={onChoose}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  )
}

function CommandPalettePanel({
  projects,
  activeWorkspaceId,
  onChoose,
  onClose
}: {
  projects: Project[]
  activeWorkspaceId: number | null
  onChoose: (row: PaletteRow) => Promise<void> | void
  onClose: () => void
}): React.JSX.Element {
  const hotkey = useKeybindBinding('openCommandPalette')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState<PaletteFilter>('all')
  const [scoped, setScoped] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const opening = useRef(false)
  // Set when a choice moves focus somewhere else, so closing does not pull it back.
  const chosen = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(timer)
  }, [query])

  const scope = located(projects, activeWorkspaceId)
  const scopeWorkspaceId = scoped && scope ? scope.workspace.id : null
  const workspaceIds =
    scopeWorkspaceId != null
      ? [scopeWorkspaceId]
      : [...new Set(projects.flatMap((project) => project.workspaces.map((item) => item.id)))]

  const search = useQuery({
    queryKey: ['chat', 'search', workspaceIds, debounced, false],
    queryFn: () => window.cerebro.chatSearch({ workspaceIds, query: debounced, pastOnly: false }),
    enabled: workspaceIds.length > 0
  })

  const groups = buildPaletteGroups({
    projects,
    hits: search.data?.hits ?? [],
    query,
    filter,
    scopeWorkspaceId
  })
  const rows = groups.flatMap((group) => group.rows)
  const resultKey = `${query}\0${debounced}\0${filter}\0${String(scopeWorkspaceId)}`
  const [highlightState, setHighlightState] = useState({ key: resultKey, index: 0 })
  const highlight = highlightState.key === resultKey ? highlightState.index : 0
  const activeIndex = Math.min(highlight, Math.max(rows.length - 1, 0))
  const active = rows[activeIndex]
  const setHighlight = (index: number): void => setHighlightState({ key: resultKey, index })

  useEffect(() => {
    if (!active) return
    document.getElementById(`command-palette-option-${active.key}`)?.scrollIntoView({
      block: 'nearest'
    })
  }, [active])

  const choose = async (row: PaletteRow): Promise<void> => {
    if (opening.current) return
    opening.current = true
    setError(null)
    try {
      chosen.current = true
      await onChoose(row)
      onClose()
    } catch (caught) {
      chosen.current = false
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      opening.current = false
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Tab') {
      event.preventDefault()
      setFilter((current) => nextPaletteFilter(current, event.shiftKey ? -1 : 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (active) void choose(active)
      return
    }
    const next = moveHighlight(event.key, activeIndex, rows.length)
    if (next == null) return
    event.preventDefault()
    setHighlight(next)
  }

  const lineFor = (hit: ChatSearchHit): string => {
    const place = located(projects, hit.workspaceId)
    if (!place) return harnessLabels[hit.harness]
    return `${place.project.name} / ${sessionWorkspaceLine(place.project, place.workspace)} · ${harnessLabels[hit.harness]}`
  }

  return (
    <DialogContent
      data-testid="command-palette"
      aria-label="Command palette"
      finalFocus={() => !chosen.current}
      className="top-[12%] z-[60] flex max-h-[min(32.5rem,calc(100%-6rem))] w-[min(38.75rem,calc(100%-2rem))] max-w-none translate-y-0 flex-col gap-0 overflow-hidden rounded-xl bg-popover p-0 opacity-100 shadow-dialog transition-none data-starting-style:opacity-100! sm:max-w-none"
      showCloseButton={false}
    >
      <DialogTitle className="sr-only">Command palette</DialogTitle>
      <div className="flex items-center gap-2.5 border-b px-3.5 py-3 text-muted-foreground">
        <Search aria-hidden className="size-4 shrink-0" />
        <input
          autoFocus
          value={query}
          placeholder="Search projects, workspaces and sessions…"
          aria-label="Search projects, workspaces and sessions"
          data-testid="command-palette-input"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          aria-controls="command-palette-results"
          aria-activedescendant={active ? `command-palette-option-${active.key}` : undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <kbd className={footKbdClass}>esc</kbd>
      </div>
      <div
        role="group"
        aria-label="Filter"
        className="flex flex-wrap gap-1.5 px-3.5 pt-2"
        data-testid="command-palette-filters"
      >
        {PALETTE_FILTERS.map((key) => (
          <FilterChip
            key={key}
            pressed={filter === key}
            testId={`command-palette-filter-${key}`}
            onClick={() => setFilter(key)}
          >
            {FILTER_LABELS[key]}
          </FilterChip>
        ))}
        {scope ? (
          <FilterChip
            pressed={scoped}
            testId="command-palette-scope"
            title="Only sessions and history in the selected workspace"
            onClick={() => setScoped((current) => !current)}
          >
            in {scope.project.name} / {workspaceRowLabel(scope.project, scope.workspace)}
          </FilterChip>
        ) : null}
      </div>
      <PaletteResults
        groups={groups}
        query={query}
        rows={rows}
        activeKey={active?.key}
        filter={filter}
        now={now}
        lineFor={lineFor}
        loading={search.isPending && !search.data}
        onHighlight={setHighlight}
        onFilter={setFilter}
        onChoose={(row) => void choose(row)}
      />
      {error || search.isError ? (
        <p role="alert" className="border-t px-3.5 py-2 text-xs text-destructive">
          {error ??
            (search.error instanceof Error ? search.error.message : 'Session search failed.')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3.5 border-t px-3.5 py-2 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className={footKbdClass}>↑</kbd>
          <kbd className={footKbdClass}>↓</kbd> move
        </span>
        <span className="flex items-center gap-1">
          <kbd className={footKbdClass}>↵</kbd> open
        </span>
        <span className="flex items-center gap-1">
          <kbd className={footKbdClass}>tab</kbd> next filter
        </span>
        <span className="ml-auto flex items-center gap-1">
          <ShortcutKbd hotkey={hotkey} /> toggle
        </span>
      </div>
    </DialogContent>
  )
}

function FilterChip({
  pressed,
  testId,
  title,
  onClick,
  children
}: {
  pressed: boolean
  testId: string
  title?: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      title={title}
      // Keep focus in the search field so typing continues after a click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'max-w-full truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring',
        pressed
          ? 'border-transparent bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function PaletteResults({
  groups,
  query,
  rows,
  activeKey,
  filter,
  now,
  lineFor,
  loading,
  onHighlight,
  onFilter,
  onChoose
}: {
  groups: PaletteGroup[]
  query: string
  rows: PaletteRow[]
  activeKey: string | undefined
  filter: PaletteFilter
  now: number
  lineFor: (hit: ChatSearchHit) => string
  loading: boolean
  onHighlight: (index: number) => void
  onFilter: (filter: PaletteFilter) => void
  onChoose: (row: PaletteRow) => void
}): React.JSX.Element {
  return (
    <div
      id="command-palette-results"
      role="listbox"
      aria-label="Results"
      className="min-h-0 flex-1 overflow-y-auto p-1.5"
    >
      {rows.length === 0 ? (
        <p className="px-2 py-8 text-center text-[13px] text-muted-foreground">
          {loading
            ? 'Searching…'
            : query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : 'Nothing here yet.'}
        </p>
      ) : (
        groups.map((group) => (
          <div
            key={group.key}
            role="group"
            aria-label={group.label}
            data-testid={`command-palette-group-${group.key}`}
          >
            <p
              className={cn(
                'flex items-center gap-2 px-2 pt-2 pb-1 text-[11px] font-medium tracking-[0.02em] text-muted-foreground',
                group.key === 'history' && historyText
              )}
            >
              {group.key === 'history' ? <History aria-hidden className="size-3.5" /> : null}
              {group.label}
              <span className="font-mono tabular-nums">{group.total}</span>
            </p>
            {group.rows.map((row) => (
              <PaletteOption
                key={row.key}
                row={row}
                query={query}
                selected={row.key === activeKey}
                now={now}
                lineFor={lineFor}
                onHighlight={() => onHighlight(rows.indexOf(row))}
                onChoose={() => onChoose(row)}
              />
            ))}
            {filter === 'all' && group.total > group.rows.length ? (
              <button
                type="button"
                className="block py-1 pr-2 pb-1.5 pl-[38px] text-left text-xs text-muted-foreground hover:text-foreground"
                data-testid={`command-palette-more-${group.key}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onFilter(group.key)}
              >
                {group.total - group.rows.length} more · show only {group.label}
              </button>
            ) : null}
          </div>
        ))
      )}
    </div>
  )
}

function Highlighted({ text, query }: { text: string; query: string }): React.JSX.Element {
  const parts = highlightParts(text, query)
  if (!parts) return <>{text}</>
  return (
    <>
      {parts.before}
      <mark className="bg-transparent font-semibold text-inherit underline decoration-ring underline-offset-2">
        {parts.match}
      </mark>
      {parts.after}
    </>
  )
}

function OptionBadge({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={cn('rounded px-1.5 py-px text-[10.5px] bg-muted text-muted-foreground', className)}
    >
      {children}
    </span>
  )
}

type OptionContent = {
  icon: React.ReactNode
  title: string
  sub: React.ReactNode
  meta: React.ReactNode
}

function optionContent(
  row: PaletteRow,
  query: string,
  now: number,
  lineFor: (hit: ChatSearchHit) => string
): OptionContent {
  if (row.type === 'project') {
    const count = row.project.workspaces.length
    return {
      icon: <Folder className="size-4" />,
      title: row.project.name,
      sub: `${count} ${count === 1 ? 'workspace' : 'workspaces'}`,
      meta: null
    }
  }
  if (row.type === 'workspace') {
    const directory = row.kind === 'directory'
    return {
      icon: directory ? <Folder className="size-4" /> : <GitBranch className="size-4" />,
      title: row.label,
      sub: directory ? 'Folder' : <Highlighted text={row.project.name} query={query} />,
      meta: <OptionBadge>{WORKSPACE_KIND_LABELS[row.kind]}</OptionBadge>
    }
  }
  const hit = row.hit
  return {
    icon: <SessionIcon hit={hit} history={row.type === 'history'} />,
    title: hit.title || 'Agent',
    sub: <Highlighted text={lineFor(hit)} query={query} />,
    meta: (
      <>
        {row.type === 'history' ? (
          <OptionBadge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
            Closed
          </OptionBadge>
        ) : (
          <OptionBadge className="text-emerald-600 dark:text-emerald-400">● Open</OptionBadge>
        )}
        {relativeUpdated(hit.updatedAt, now)}
      </>
    )
  }
}

function SessionIcon({
  hit,
  history
}: {
  hit: ChatSearchHit
  history: boolean
}): React.JSX.Element {
  if (history) return <History className="size-4" />
  if (hit.status !== 'idle') {
    return <HarnessStatusIcon harness={hit.harness} status={hit.status} surface="sidebar" />
  }
  return <HarnessIcon harness={hit.harness} />
}

function PaletteOption({
  row,
  query,
  selected,
  now,
  lineFor,
  onHighlight,
  onChoose
}: {
  row: PaletteRow
  query: string
  selected: boolean
  now: number
  lineFor: (hit: ChatSearchHit) => string
  onHighlight: () => void
  onChoose: () => void
}): React.JSX.Element {
  const history = row.type === 'history'
  const { icon, title, sub, meta } = optionContent(row, query, now, lineFor)
  return (
    <button
      type="button"
      id={`command-palette-option-${row.key}`}
      role="option"
      aria-selected={selected}
      data-testid="command-palette-option"
      data-row-type={row.type}
      data-row-key={row.key}
      className={cn(
        'grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[7px] px-2 py-[7px] text-left',
        selected && 'bg-accent text-accent-foreground'
      )}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (!selected) onHighlight()
      }}
      onClick={onChoose}
    >
      <span className={cn('grid place-items-center text-muted-foreground', history && historyText)}>
        {icon}
      </span>
      <span className="grid min-w-0">
        <span className={cn('truncate text-[13px]', history && historyText)}>
          <Highlighted text={title} query={query} />
        </span>
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <span className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
        {meta}
      </span>
    </button>
  )
}
