import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  parseDiffFromFile,
  type CodeViewItem,
  type DiffLineAnnotation,
  type LineAnnotation
} from '@pierre/diffs'
import { CodeView, type CodeViewHandle, type CodeViewReactOptions } from '@pierre/diffs/react'
import { PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react'
import type {
  ChangedFile,
  FileDiffContents,
  RepoChangeGroup,
  WorkspaceChanges
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChangesFileList } from '@/components/changes-file-list'
import { changeItemId } from '@/lib/changes'
import { cn } from '@/lib/utils'

export type ChangesAnnotationRender = (
  annotation: LineAnnotation | DiffLineAnnotation,
  item: CodeViewItem<undefined>
) => React.ReactNode

type ChangesViewProps = {
  workspaceId: number
  active: boolean
  annotationsByItem?: Record<string, DiffLineAnnotation[]>
  renderAnnotation?: ChangesAnnotationRender
}

const CODE_VIEW_OPTIONS: CodeViewReactOptions<undefined, undefined> = {
  theme: 'pierre-dark',
  themeType: 'dark',
  stickyHeaders: true,
  layout: { paddingTop: 8, paddingBottom: 16, gap: 12 }
}

const CODE_VIEW_STYLE = { height: '100%', overflow: 'auto' } as const

const DEFAULT_FILES_WIDTH = 224
const MIN_FILES_WIDTH = 160
const MAX_FILES_WIDTH = 480
const MIN_DIFF_WIDTH = 240
const COLLAPSED_FILES_WIDTH = 32
const RAIL_DRAG_THRESHOLD = 6

type ListedFile = {
  repositoryId: number
  repositoryName: string
  file: ChangedFile
}

function listedFiles(groups: RepoChangeGroup[]): ListedFile[] {
  return groups.flatMap((group) =>
    group.files.map((file) => ({
      repositoryId: group.repositoryId,
      repositoryName: group.repositoryName,
      file
    }))
  )
}

function toCodeViewItem(
  entry: ListedFile,
  diff: FileDiffContents,
  annotations: DiffLineAnnotation[] | undefined,
  showRepo: boolean
): CodeViewItem<undefined> | null {
  if (diff.kind !== 'text') return null
  if (diff.oldContents == null && diff.newContents == null) return null

  const displayName = showRepo ? `${entry.repositoryName}/${entry.file.path}` : entry.file.path
  const oldFile =
    diff.oldContents == null ? null : { name: displayName, contents: diff.oldContents }
  const newFile =
    diff.newContents == null ? null : { name: displayName, contents: diff.newContents }

  return {
    id: changeItemId(entry.repositoryId, entry.file.path),
    type: 'diff',
    fileDiff: parseDiffFromFile(oldFile, newFile),
    annotations
  }
}

export function ChangesView({
  workspaceId,
  active,
  annotationsByItem,
  renderAnnotation
}: ChangesViewProps): React.JSX.Element {
  const viewerRef = useRef<CodeViewHandle<undefined, undefined>>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [filesOpen, setFilesOpen] = useState(true)
  const [filesWidth, setFilesWidth] = useState(DEFAULT_FILES_WIDTH)
  const [filesDragging, setFilesDragging] = useState(false)
  const [changes, setChanges] = useState<WorkspaceChanges | null>(null)
  const [diffs, setDiffs] = useState<FileDiffContents[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const showRepoInHeader = (changes?.groups.length ?? 0) > 1

  const applyListed = useCallback((listed: WorkspaceChanges, loaded: FileDiffContents[]): void => {
    const entries = listedFiles(listed.groups)
    setChanges(listed)
    setDiffs(loaded)
    setError(null)
    setSelectedId((current) => {
      if (
        current &&
        entries.some((entry) => changeItemId(entry.repositoryId, entry.file.path) === current)
      ) {
        return current
      }
      const first = entries[0]
      return first ? changeItemId(first.repositoryId, first.file.path) : null
    })
  }, [])

  const fetchChanges = useCallback(async (): Promise<{
    listed: WorkspaceChanges
    loaded: FileDiffContents[]
  }> => {
    const listed = await window.cerebro.listWorkspaceChanges(workspaceId)
    const entries = listedFiles(listed.groups)
    const loaded = await Promise.all(
      entries.map(async (entry) =>
        window.cerebro.getWorkspaceFileDiff(workspaceId, entry.repositoryId, entry.file)
      )
    )
    return { listed, loaded }
  }, [workspaceId])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void (async () => {
      try {
        const { listed, loaded } = await fetchChanges()
        if (cancelled) return
        applyListed(listed, loaded)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load changes.')
        setChanges(null)
        setDiffs([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, applyListed, fetchChanges])

  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    if (!changes) return []
    const entries = listedFiles(changes.groups)
    const byKey = new Map(diffs.map((diff) => [`${diff.repositoryId}:${diff.path}`, diff] as const))
    return entries.flatMap((entry) => {
      const diff = byKey.get(`${entry.repositoryId}:${entry.file.path}`)
      if (!diff) return []
      const item = toCodeViewItem(
        entry,
        diff,
        annotationsByItem?.[changeItemId(entry.repositoryId, entry.file.path)],
        showRepoInHeader
      )
      return item ? [item] : []
    })
  }, [annotationsByItem, changes, diffs, showRepoInHeader])

  const fileCount = changes ? listedFiles(changes.groups).length : 0

  const handleSelect = (itemId: string): void => {
    setSelectedId(itemId)
    viewerRef.current?.scrollTo({ type: 'item', id: itemId, align: 'start' })
  }

  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<undefined>): React.ReactNode => {
      if (!showRepoInHeader || item.type !== 'diff') return null
      const repoId = item.id.slice(0, item.id.indexOf(':'))
      const group = changes?.groups.find((entry) => String(entry.repositoryId) === repoId)
      if (!group) return null
      return <span className="text-[10px] text-muted-foreground">{group.repositoryName}</span>
    },
    [changes, showRepoInHeader]
  )

  const toggleFiles = (): void => {
    setFilesOpen((current) => !current)
  }

  return (
    <div
      ref={rootRef}
      data-testid="changes-view"
      data-workspace-id={workspaceId}
      data-active={active ? 'true' : 'false'}
      data-dragging={filesDragging ? 'true' : undefined}
      className="absolute inset-0 flex min-h-0 bg-background"
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
        zIndex: active ? 1 : 0
      }}
    >
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="changes-diff">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Loading changes…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
            {error}
          </div>
        ) : fileCount === 0 ? (
          <div
            data-testid="changes-empty"
            className="flex h-full items-center justify-center text-sm text-muted-foreground"
          >
            No changes
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No text diffs to display
          </div>
        ) : (
          <CodeView
            ref={viewerRef}
            items={items}
            style={CODE_VIEW_STYLE}
            options={CODE_VIEW_OPTIONS}
            disableWorkerPool
            renderHeaderPrefix={showRepoInHeader ? renderHeaderPrefix : undefined}
            renderAnnotation={renderAnnotation}
          />
        )}
      </div>
      <aside
        data-testid="changes-sidebar"
        data-state={filesOpen ? 'expanded' : 'collapsed'}
        aria-expanded={filesOpen}
        className={cn(
          'relative flex shrink-0 flex-col overflow-hidden border-l border-border bg-background',
          !filesDragging && 'transition-[width] duration-150'
        )}
        style={{ width: filesOpen ? filesWidth : COLLAPSED_FILES_WIDTH }}
      >
        <ChangesSidebarRail
          open={filesOpen}
          containerRef={rootRef}
          onToggle={toggleFiles}
          onResize={setFilesWidth}
          onDraggingChange={setFilesDragging}
        />
        <div className={cn('flex min-h-0 flex-1 flex-col', !filesOpen && 'hidden')}>
          <div
            className="flex items-center gap-1 border-b border-border px-1.5 py-1"
            style={{ paddingRight: 'calc(var(--pane-controls-width, 0px) + 6px)' }}
          >
            <span className="min-w-0 flex-1 truncate px-1 text-[11px] font-medium text-muted-foreground">
              Files
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  data-testid="changes-refresh"
                  aria-label="Refresh changes"
                  onClick={(): void => {
                    setLoading(true)
                    void fetchChanges()
                      .then(({ listed, loaded }) => {
                        applyListed(listed, loaded)
                      })
                      .catch((err: unknown) => {
                        setError(err instanceof Error ? err.message : 'Failed to load changes.')
                        setChanges(null)
                        setDiffs([])
                      })
                      .finally(() => setLoading(false))
                  }}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  data-testid="changes-sidebar-toggle"
                  aria-label="Collapse files"
                  onClick={toggleFiles}
                >
                  <PanelRightClose className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Collapse</TooltipContent>
            </Tooltip>
          </div>
          {loading && !changes ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">Loading…</div>
          ) : fileCount === 0 ? (
            <div
              data-testid="changes-sidebar-empty"
              className="px-3 py-4 text-xs text-muted-foreground"
            >
              No changes
            </div>
          ) : (
            <ChangesFileList
              groups={changes?.groups ?? []}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          )}
        </div>
        {!filesOpen && (
          <div
            className="flex flex-col items-center py-1"
            style={{ paddingTop: 'calc(var(--pane-controls-height, 0px) + 4px)' }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  data-testid="changes-sidebar-toggle"
                  aria-label="Expand files"
                  onClick={toggleFiles}
                >
                  <PanelRightOpen className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Expand files</TooltipContent>
            </Tooltip>
          </div>
        )}
      </aside>
    </div>
  )
}

function ChangesSidebarRail({
  open,
  containerRef,
  onToggle,
  onResize,
  onDraggingChange
}: {
  open: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  onToggle: () => void
  onResize: (width: number) => void
  onDraggingChange: (dragging: boolean) => void
}): React.JSX.Element {
  const didDragRef = useRef(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const finishDrag = useCallback((): void => {
    dragRef.current = null
    onDraggingChange(false)
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }, [onDraggingChange])

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    didDragRef.current = false
    if (!open) return

    const sidebar = event.currentTarget.closest('[data-testid="changes-sidebar"]')
    const startWidth = sidebar?.getBoundingClientRect().width
    if (!startWidth) return

    dragRef.current = { startX: event.clientX, startWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.style.userSelect = 'none'
  }

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag) return

    const delta = drag.startX - event.clientX
    if (!didDragRef.current) {
      if (Math.abs(delta) < RAIL_DRAG_THRESHOLD) return
      didDragRef.current = true
      onDraggingChange(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? MAX_FILES_WIDTH
    const maxWidth = Math.min(
      MAX_FILES_WIDTH,
      Math.max(MIN_FILES_WIDTH, containerWidth - MIN_DIFF_WIDTH)
    )
    const next = Math.min(maxWidth, Math.max(MIN_FILES_WIDTH, drag.startWidth + delta))
    onResize(Math.round(next))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishDrag()
  }

  return (
    <button
      type="button"
      data-testid="changes-sidebar-rail"
      aria-label="Resize files"
      tabIndex={-1}
      title="Drag to resize"
      onClick={(event): void => {
        if (didDragRef.current) {
          event.preventDefault()
          return
        }
        onToggle()
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={finishDrag}
      className={cn(
        'app-no-drag absolute inset-y-0 left-0 z-20 w-4 -translate-x-1/2 touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-border',
        open ? 'cursor-col-resize' : 'cursor-w-resize',
        'in-data-[dragging=true]:after:bg-border'
      )}
    />
  )
}
