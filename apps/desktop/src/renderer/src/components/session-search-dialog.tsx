import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import type { ChatSearchHit } from '@cerebro/core'
import type { Project, Workspace } from '@shared/types'
import { HarnessIcon, HarnessStatusIcon } from '@/components/harness-icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ShortcutKbd, useKeybindBinding } from '@/keybinds'
import { relativeUpdated } from '@/lib/agent-status-text'
import { cn } from '@/lib/utils'

export type SessionSearchRequest = { mode: 'palette' } | { mode: 'workspace'; workspaceId: number }

type Scope = 'workspace' | 'project'

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
  activeWorkspaceId,
  labelFor,
  onOpen,
  onClose
}: {
  request: SessionSearchRequest | null
  projects: Project[]
  activeWorkspaceId: number | null
  labelFor: (project: Project, workspace: Workspace) => string
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
          activeWorkspaceId={activeWorkspaceId}
          labelFor={labelFor}
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
  activeWorkspaceId,
  labelFor,
  onOpen,
  onClose
}: {
  request: SessionSearchRequest
  projects: Project[]
  activeWorkspaceId: number | null
  labelFor: (project: Project, workspace: Workspace) => string
  onOpen: (hit: ChatSearchHit) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const hotkey = useKeybindBinding('searchSessions')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [scope, setScope] = useState<Scope>('workspace')
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const opening = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(timer)
  }, [query])

  const anchorId = request?.mode === 'workspace' ? request.workspaceId : activeWorkspaceId
  const anchor = anchorId == null ? null : located(projects, anchorId)
  const pastOnly = request?.mode === 'workspace'
  const workspaceIds = useMemo(() => {
    if (!anchor) return []
    if (pastOnly || scope === 'workspace') return [anchor.workspace.id]
    return anchor.project.workspaces.map((workspace) => workspace.id)
  }, [anchor, pastOnly, scope])
  const labels = useMemo(() => {
    const map = new Map<number, string>()
    if (!anchor) return map
    for (const workspace of anchor.project.workspaces)
      map.set(workspace.id, labelFor(anchor.project, workspace))
    return map
  }, [anchor, labelFor])

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
  const openHits = hits.filter((hit) => hit.open)
  const pastHits = hits.filter((hit) => !hit.open)
  const rows = [...openHits, ...pastHits]
  const resultKey = `${debounced}\0${workspaceIds.join(',')}\0${String(pastOnly)}`
  const [highlightState, setHighlightState] = useState({ key: resultKey, index: 0 })
  const highlight = highlightState.key === resultKey ? highlightState.index : 0
  const active = rows[Math.min(highlight, Math.max(rows.length - 1, 0))]
  const setHighlight = (index: number): void => setHighlightState({ key: resultKey, index })

  const choose = async (hit: ChatSearchHit): Promise<void> => {
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

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!rows.length) return
      const next = event.key === 'ArrowDown' ? highlight + 1 : highlight - 1
      setHighlight((next + rows.length) % rows.length)
    }
  }

  const workspaceName = anchor ? labelFor(anchor.project, anchor.workspace) : ''
  const showProjectNames = request?.mode === 'palette' && scope === 'project'
  const empty =
    request?.mode === 'palette' && activeWorkspaceId == null
      ? 'Select a workspace to search its sessions.'
      : search.isError
        ? null
        : pastOnly && !debounced.trim()
          ? 'No past sessions in this workspace.'
          : debounced.trim()
            ? 'No matching sessions.'
            : 'No sessions.'

  return (
    <DialogContent
      data-testid="session-search-dialog"
      className="top-[12%] flex max-h-[min(32rem,calc(100%-6rem))] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      showCloseButton={false}
    >
      <DialogHeader className="gap-3 border-b px-3 py-3">
        <div className="flex items-center gap-2 pr-2">
          <DialogTitle className="text-sm">
            {pastOnly ? 'Past sessions' : 'Search sessions'}
          </DialogTitle>
          <ShortcutKbd hotkey={hotkey} className="ml-auto" />
        </div>
        {request?.mode === 'palette' && anchor ? (
          <div className="flex gap-1" role="group" aria-label="Search scope">
            <Button
              type="button"
              size="xs"
              variant={scope === 'workspace' ? 'secondary' : 'ghost'}
              aria-pressed={scope === 'workspace'}
              data-testid="session-search-scope-workspace"
              onClick={() => setScope('workspace')}
            >
              This workspace
              <span className="max-w-32 truncate font-normal text-muted-foreground">
                {workspaceName}
              </span>
            </Button>
            <Button
              type="button"
              size="xs"
              variant={scope === 'project' ? 'secondary' : 'ghost'}
              aria-pressed={scope === 'project'}
              data-testid="session-search-scope-project"
              onClick={() => setScope('project')}
            >
              This project
              <span className="max-w-32 truncate font-normal text-muted-foreground">
                {anchor.project.name}
              </span>
            </Button>
          </div>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (active) void choose(active)
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              placeholder={pastOnly ? 'Search past sessions' : 'Search sessions'}
              aria-label={pastOnly ? 'Search past sessions' : 'Search sessions'}
              data-testid="session-search-input"
              className="pl-8"
              aria-controls="session-search-results"
              aria-activedescendant={active ? `session-search-hit-${active.sessionId}` : undefined}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
        </form>
      </DialogHeader>
      <div
        id="session-search-results"
        role="listbox"
        aria-label="Sessions"
        className="min-h-0 flex-1 overflow-y-auto p-1"
      >
        {search.isError ? (
          <p role="alert" className="px-2 py-6 text-center text-sm text-destructive">
            {search.error instanceof Error ? search.error.message : 'Search failed.'}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <>
            {openHits.length > 0 ? (
              <ResultGroup
                label="Open"
                hits={openHits}
                activeId={active?.sessionId}
                showWorkspace={showProjectNames}
                labels={labels}
                now={now}
                onHighlight={setHighlight}
                onChoose={(hit) => void choose(hit)}
                indexOf={(hit) => rows.indexOf(hit)}
              />
            ) : null}
            {pastHits.length > 0 ? (
              <ResultGroup
                label="Past"
                hits={pastHits}
                activeId={active?.sessionId}
                showWorkspace={showProjectNames}
                labels={labels}
                now={now}
                onHighlight={setHighlight}
                onChoose={(hit) => void choose(hit)}
                indexOf={(hit) => rows.indexOf(hit)}
              />
            ) : null}
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="border-t px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : search.data && search.data.total > search.data.hits.length ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Showing {search.data.hits.length} of {search.data.total}
        </p>
      ) : null}
    </DialogContent>
  )
}

function ResultGroup({
  label,
  hits,
  activeId,
  showWorkspace,
  labels,
  now,
  onHighlight,
  onChoose,
  indexOf
}: {
  label: string
  hits: ChatSearchHit[]
  activeId: string | undefined
  showWorkspace: boolean
  labels: Map<number, string>
  now: number
  onHighlight: (index: number) => void
  onChoose: (hit: ChatSearchHit) => void
  indexOf: (hit: ChatSearchHit) => number
}): React.JSX.Element {
  return (
    <div className="mb-1">
      <p className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
      {hits.map((hit) => {
        const selected = hit.sessionId === activeId
        const workspace = labels.get(hit.workspaceId)
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
              {showWorkspace && workspace ? (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {workspace}
                </span>
              ) : null}
              {hit.snippet ? (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {hit.snippet}
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
