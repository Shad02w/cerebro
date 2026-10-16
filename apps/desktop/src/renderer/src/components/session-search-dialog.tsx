import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import type { ChatSearchHit } from '@cerebro/core'
import type { Project, Workspace } from '@shared/types'
import { HarnessIcon, HarnessStatusIcon } from '@/components/harness-icon'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ShortcutKbd, useKeybindBinding } from '@/keybinds'
import { relativeUpdated } from '@/lib/agent-status-text'
import {
  groupSessionsByProject,
  sessionWorkspaceLine,
  type SessionProjectGroup
} from '@/lib/session-workspace-line'
import { cn } from '@/lib/utils'

export type SessionSearchRequest = { mode: 'palette' } | { mode: 'workspace'; workspaceId: number }

function sessionSearchEmpty(pastOnly: boolean, query: string, failed: boolean): string | null {
  if (failed) return null
  if (pastOnly && !query.trim()) return 'No closed sessions in this workspace.'
  if (query.trim()) return 'No matching sessions.'
  return 'No sessions.'
}

function paletteWorkspaceIds(request: SessionSearchRequest, projects: Project[]): number[] {
  if (request.mode === 'workspace') return [request.workspaceId]
  return [
    ...new Set(projects.flatMap((project) => project.workspaces.map((workspace) => workspace.id)))
  ]
}

function moveHighlight(key: string, highlight: number, count: number): number | null {
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null
  if (!count) return highlight
  const next = key === 'ArrowDown' ? highlight + 1 : highlight - 1
  return (next + count) % count
}

async function openChosen(
  hit: ChatSearchHit,
  opening: { current: boolean },
  onOpen: (hit: ChatSearchHit) => Promise<void>,
  onClose: () => void,
  setError: (message: string | null) => void
): Promise<void> {
  if (opening.current) return
  opening.current = true
  setError(null)
  try {
    await onOpen(hit)
    onClose()
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught))
  } finally {
    opening.current = false
  }
}

function located(
  projects: Project[],
  workspaceId: number
): { project: Project; workspace: Workspace } | null {
  for (const project of projects) {
    const workspace = project.workspaces.find((item) => item.id === workspaceId)
    if (workspace) return { project, workspace }
  }
  return null
}

export function SessionSearchDialog({
  request,
  projects,
  onOpen,
  onClose
}: {
  request: SessionSearchRequest | null
  projects: Project[]
  onOpen: (hit: ChatSearchHit) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const requestKey =
    request == null
      ? ''
      : request.mode === 'palette'
        ? 'palette'
        : `workspace:${request.workspaceId}`
  return (
    <Dialog
      open={request != null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {request ? (
        <SessionSearchPanel
          key={requestKey}
          request={request}
          projects={projects}
          onOpen={onOpen}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  )
}

function SessionSearchPanel({
  request,
  projects,
  onOpen,
  onClose
}: {
  request: SessionSearchRequest
  projects: Project[]
  onOpen: (hit: ChatSearchHit) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const hotkey = useKeybindBinding('searchSessions')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const opening = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(timer)
  }, [query])

  const history = request.mode === 'workspace' ? located(projects, request.workspaceId) : null
  const pastOnly = request.mode === 'workspace'
  const workspaceIds = useMemo(() => paletteWorkspaceIds(request, projects), [request, projects])

  const search = useQuery({
    queryKey: ['chat', 'search', workspaceIds, debounced, pastOnly],
    queryFn: () =>
      window.cerebro.chatSearch({
        workspaceIds,
        query: debounced,
        pastOnly
      }),
    enabled: request != null && workspaceIds.length > 0
  })

  const hits = search.data?.hits ?? []
  const groups = groupSessionsByProject(projects, hits)
  const rows = groups.flatMap((group) => [...group.open, ...group.closed])
  const lineFor = (hit: ChatSearchHit): string => {
    const place = located(projects, hit.workspaceId)
    return place ? sessionWorkspaceLine(place.project, place.workspace) : ''
  }
  const resultKey = `${debounced}\0${workspaceIds.join(',')}\0${String(pastOnly)}`
  const [highlightState, setHighlightState] = useState({ key: resultKey, index: 0 })
  const highlight = highlightState.key === resultKey ? highlightState.index : 0
  const active = rows[Math.min(highlight, Math.max(rows.length - 1, 0))]
  const setHighlight = (index: number): void => setHighlightState({ key: resultKey, index })

  const choose = (hit: ChatSearchHit): Promise<void> =>
    openChosen(hit, opening, onOpen, onClose, setError)

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const next = moveHighlight(event.key, highlight, rows.length)
    if (next == null) return
    event.preventDefault()
    setHighlight(next)
  }

  const empty = sessionSearchEmpty(pastOnly, debounced, search.isError)
  const scope = history
    ? `${history.project.name} · ${sessionWorkspaceLine(history.project, history.workspace)}`
    : null

  return (
    <DialogContent
      data-testid="session-search-dialog"
      className="top-[12%] flex max-h-[min(32rem,calc(100%-6rem))] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      showCloseButton={false}
    >
      <SessionSearchHeader
        pastOnly={pastOnly}
        scope={scope}
        hotkey={hotkey}
        query={query}
        activeId={active?.sessionId}
        onQuery={setQuery}
        onKeyDown={onKeyDown}
        onSubmit={() => {
          if (active) void choose(active)
        }}
      />
      <SessionSearchResults
        error={search.isError ? search.error : null}
        empty={empty}
        pastOnly={pastOnly}
        groups={groups}
        rows={rows}
        activeId={active?.sessionId}
        now={now}
        lineFor={lineFor}
        onHighlight={setHighlight}
        onChoose={(hit) => void choose(hit)}
      />
      <SessionSearchNotice
        error={error}
        shown={search.data?.hits.length ?? 0}
        total={search.data?.total ?? 0}
      />
    </DialogContent>
  )
}

function SessionSearchNotice({
  error,
  shown,
  total
}: {
  error: string | null
  shown: number
  total: number
}): React.JSX.Element | null {
  if (error) {
    return (
      <p role="alert" className="border-t px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    )
  }
  if (total > shown) {
    return (
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        Showing {shown} of {total}
      </p>
    )
  }
  return null
}

function SessionSearchHeader({
  pastOnly,
  scope,
  hotkey,
  query,
  activeId,
  onQuery,
  onKeyDown,
  onSubmit
}: {
  pastOnly: boolean
  scope: string | null
  hotkey: string
  query: string
  activeId: string | undefined
  onQuery: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onSubmit: () => void
}): React.JSX.Element {
  const label = pastOnly ? 'Search this workspace' : 'Search sessions'
  return (
    <DialogHeader className="gap-3 border-b px-3 py-3">
      <div className="flex items-center gap-2 pr-2">
        <DialogTitle className="text-sm">{pastOnly ? 'History' : 'Search sessions'}</DialogTitle>
        {scope ? (
          <span
            data-testid="session-search-scope"
            className="truncate text-xs text-muted-foreground"
          >
            {scope}
          </span>
        ) : null}
        {pastOnly ? null : <ShortcutKbd hotkey={hotkey} className="ml-auto" />}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            placeholder={label}
            aria-label={label}
            data-testid="session-search-input"
            className="pl-8"
            aria-controls="session-search-results"
            aria-activedescendant={activeId ? `session-search-hit-${activeId}` : undefined}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      </form>
    </DialogHeader>
  )
}

function SessionSearchResults({
  error,
  empty,
  pastOnly,
  groups,
  rows,
  activeId,
  now,
  lineFor,
  onHighlight,
  onChoose
}: {
  error: unknown
  empty: string | null
  pastOnly: boolean
  groups: SessionProjectGroup[]
  rows: ChatSearchHit[]
  activeId: string | undefined
  now: number
  lineFor: (hit: ChatSearchHit) => string
  onHighlight: (index: number) => void
  onChoose: (hit: ChatSearchHit) => void
}): React.JSX.Element {
  const indexOf = (hit: ChatSearchHit): number => rows.indexOf(hit)
  return (
    <div
      id="session-search-results"
      role="listbox"
      aria-label="Sessions"
      className="min-h-0 flex-1 overflow-y-auto p-1"
    >
      {error ? (
        <p role="alert" className="px-2 py-6 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : 'Search failed.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : pastOnly ? (
        <ResultGroup
          label="Closed"
          hits={rows}
          activeId={activeId}
          now={now}
          lineFor={lineFor}
          onHighlight={onHighlight}
          onChoose={onChoose}
          indexOf={indexOf}
        />
      ) : (
        groups.map((group) => (
          <div key={group.project.id} className="mb-2">
            <p
              data-testid="session-search-project"
              className="px-2 pt-1.5 text-xs font-medium text-foreground"
            >
              {group.project.name}
            </p>
            {group.open.length > 0 ? (
              <ResultGroup
                label="Open"
                hits={group.open}
                activeId={activeId}
                now={now}
                lineFor={lineFor}
                onHighlight={onHighlight}
                onChoose={onChoose}
                indexOf={indexOf}
              />
            ) : null}
            {group.closed.length > 0 ? (
              <ResultGroup
                label="Closed"
                hits={group.closed}
                activeId={activeId}
                now={now}
                lineFor={lineFor}
                onHighlight={onHighlight}
                onChoose={onChoose}
                indexOf={indexOf}
              />
            ) : null}
          </div>
        ))
      )}
    </div>
  )
}

function ResultGroup({
  label,
  hits,
  activeId,
  now,
  lineFor,
  onHighlight,
  onChoose,
  indexOf
}: {
  label: string
  hits: ChatSearchHit[]
  activeId: string | undefined
  now: number
  lineFor: (hit: ChatSearchHit) => string
  onHighlight: (index: number) => void
  onChoose: (hit: ChatSearchHit) => void
  indexOf: (hit: ChatSearchHit) => number
}): React.JSX.Element {
  return (
    <div className="mb-1">
      <p className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
      {hits.map((hit) => {
        const selected = hit.sessionId === activeId
        return (
          <button
            key={hit.sessionId}
            id={`session-search-hit-${hit.sessionId}`}
            type="button"
            role="option"
            aria-selected={selected}
            data-testid="session-search-hit"
            data-session-id={hit.sessionId}
            className={cn(
              'flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left',
              selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
            )}
            onMouseEnter={() => onHighlight(indexOf(hit))}
            onClick={() => onChoose(hit)}
          >
            <span className="mt-0.5 shrink-0">
              {hit.open && hit.status !== 'idle' ? (
                <HarnessStatusIcon harness={hit.harness} status={hit.status} surface="sidebar" />
              ) : (
                <HarnessIcon harness={hit.harness} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{hit.title || 'Agent'}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {relativeUpdated(hit.updatedAt, now)}
                </span>
              </span>
              <span
                data-session-workspace
                className="block truncate text-[11px] text-muted-foreground"
              >
                {lineFor(hit)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
