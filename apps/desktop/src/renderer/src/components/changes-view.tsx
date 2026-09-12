import type { Pane } from '@cerebro/core'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_VIRTUAL_FILE_METRICS,
  type CodeViewDiffItem,
  type CodeViewItem,
  type DiffLineAnnotation,
  type LineAnnotation
} from '@pierre/diffs'
import {
  FileDiff,
  Virtualizer,
  useVirtualizer,
  WorkerPoolContextProvider,
  type FileDiffOptions
} from '@pierre/diffs/react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileImage,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChangesFileList } from '@/components/changes-file-list'
import { ChangesImagePreview } from '@/components/changes-image-preview'
import { changeItemId } from '@/lib/changes'
import { changesOptions, changesManifestOptions, type LoadedChange } from '@/lib/changes-query'
import { changesWorkerPool, changesHighlighterOptions } from '@/lib/changes-highlighter'
import { queryClient } from '@/lib/query-client'
import { cn } from '@/lib/utils'

export type ChangesAnnotationRender = (
  annotation: LineAnnotation | DiffLineAnnotation,
  item: CodeViewItem<undefined>
) => React.ReactNode

type ChangesViewProps = {
  workspaceId: number
  paneId?: number
  repositoryId?: number | null
  savedState?: Pane['state']
  active: boolean
  annotationsByItem?: Record<string, DiffLineAnnotation[]>
  renderAnnotation?: ChangesAnnotationRender
}

const DIFF_OPTIONS: FileDiffOptions<undefined, undefined> = {
  theme: 'pierre-dark',
  themeType: 'dark',
  stickyHeader: true,
  unsafeCSS: `
    [data-diffs-header] {
      box-sizing: border-box;
      height: 32px;
      min-height: 32px;
      padding-inline: 12px;
      font-size: 12px;
    }
  `
}

// Keep virtualized height estimates aligned with the compact header CSS.
const DIFF_METRICS = { ...DEFAULT_VIRTUAL_FILE_METRICS, diffHeaderHeight: 32 }
const SCROLL_STYLE = { height: '100%', overflow: 'auto' } as const

const DEFAULT_FILES_WIDTH = 224
const MIN_FILES_WIDTH = 160
const MAX_FILES_WIDTH = 480
const MIN_DIFF_WIDTH = 240
const COLLAPSED_FILES_WIDTH = 32
const RAIL_DRAG_THRESHOLD = 6

function ChangeScrollTarget({ request }: { request: { id: string } | null }): null {
  const virtualizer = useVirtualizer()
  useLayoutEffect(() => {
    if (!request || !virtualizer) return
    // Wait for FileDiff to apply expansion and update its estimated height.
    const frame = requestAnimationFrame(() => {
      const root = virtualizer.getRoot()
      const element = root?.querySelector<HTMLElement>(
        `[data-change-id="${CSS.escape(request.id)}"]`
      )
      if (element) virtualizer.scrollTo({ top: virtualizer.getOffsetInScrollContainer(element) })
    })
    return () => cancelAnimationFrame(frame)
  }, [request, virtualizer])
  return null
}

const ChangeFileContent = memo(function ChangeFileContent({
  item,
  collapsed,
  onToggle,
  renderAnnotation,
  annotations
}: {
  item: LoadedChange
  collapsed: boolean
  onToggle: (id: string) => void
  renderAnnotation?: ChangesAnnotationRender
  annotations?: DiffLineAnnotation[]
}): React.JSX.Element {
  const textItem = useMemo<CodeViewDiffItem<undefined> | null>(
    () =>
      item.fileDiff
        ? {
            id: item.id,
            type: 'diff',
            fileDiff: item.fileDiff,
            annotations
          }
        : null,
    [item, annotations]
  )
  const options = useMemo(() => ({ ...DIFF_OPTIONS, collapsed }), [collapsed])
  const renderToggle = useCallback(
    () => (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${item.displayName}`}
        aria-expanded={!collapsed}
        onClick={() => onToggle(item.id)}
      >
        {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </Button>
    ),
    [collapsed, item.displayName, item.id, onToggle]
  )
  const renderLineAnnotation = useCallback(
    (annotation: DiffLineAnnotation) =>
      textItem ? renderAnnotation?.(annotation, textItem) : null,
    [textItem, renderAnnotation]
  )

  return (
    <section data-change-id={item.id} data-change-path={item.diff.path} className="min-w-0">
      {textItem ? (
        <FileDiff
          fileDiff={textItem.fileDiff}
          options={options}
          metrics={DIFF_METRICS}
          lineAnnotations={textItem.annotations}
          renderHeaderPrefix={renderToggle}
          renderAnnotation={renderAnnotation ? renderLineAnnotation : undefined}
        />
      ) : (
        <>
          <div
            data-testid="changes-file-header"
            className="sticky top-0 z-10 flex h-8 items-center gap-2 bg-background px-3"
          >
            {renderToggle()}
            <FileImage className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs" title={item.displayName}>
              {item.displayName}
            </span>
            <span className="text-xs text-muted-foreground capitalize">{item.diff.status}</span>
          </div>
          {!collapsed && <ChangesImagePreview diff={item.diff} />}
        </>
      )}
    </section>
  )
})

function DiffFoldControls({
  onCollapseAll,
  onExpandAll
}: {
  onCollapseAll: () => void
  onExpandAll: () => void
}): React.JSX.Element {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Collapse all diffs"
            onClick={onCollapseAll}
          >
            <ChevronsDownUp className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Collapse all diffs</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Expand all diffs"
            onClick={onExpandAll}
          >
            <ChevronsUpDown className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Expand all diffs</TooltipContent>
      </Tooltip>
    </>
  )
}

export function ChangesView({
  workspaceId,
  paneId,
  repositoryId,
  savedState,
  active,
  annotationsByItem,
  renderAnnotation
}: ChangesViewProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [filesOpen, setFilesOpen] = useState(savedState?.filesOpen ?? true)
  const [filesWidth, setFilesWidth] = useState(savedState?.filesWidth ?? DEFAULT_FILES_WIDTH)
  const [filesDragging, setFilesDragging] = useState(false)
  const query = useQuery({
    ...changesOptions(workspaceId, repositoryId),
    enabled: active,
    // An open tab retains its cache even while hidden, without repainting on updates.
    notifyOnChangeProps: active ? undefined : []
  })
  useEffect(() => {
    if (active) return
    const queryKey = changesOptions(workspaceId, repositoryId).queryKey
    // Another visible Changes pane may be using the same in-flight refresh.
    if (!queryClient.getQueryCache().find({ queryKey, exact: true })?.isActive()) {
      void queryClient.cancelQueries({ queryKey, exact: true })
    }
  }, [active, workspaceId, repositoryId])
  const manifest = useQuery(changesManifestOptions(workspaceId, repositoryId))
  const changes = query.data?.listed ?? manifest.data
  const loading = !query.data && query.isPending
  const [selection, setSelectedId] = useState<string | null>(savedState?.selectedId ?? null)
  const entries = useMemo(
    () =>
      changes?.groups.flatMap((group) =>
        group.files.map((file) => changeItemId(group.repositoryId, file.path))
      ) ?? [],
    [changes]
  )
  const selectedId = selection && entries.includes(selection) ? selection : (entries[0] ?? null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const [scrollRequest, setScrollRequest] = useState<{ id: string } | null>(null)
  const [stateError, setError] = useState<string | null>(null)
  const error = query.error?.message ?? stateError
  const latestState = useRef({ version: 1 as const, selectedId, filesOpen, filesWidth })
  useEffect(() => {
    latestState.current = { version: 1, selectedId, filesOpen, filesWidth }
  }, [selectedId, filesOpen, filesWidth])
  useEffect(
    () => () => {
      if (paneId != null)
        void window.cerebro.setPaneState(workspaceId, paneId, latestState.current).catch(() => {})
    },
    [workspaceId, paneId]
  )
  useEffect(() => {
    if (paneId == null) return
    const timer = setTimeout(() => {
      void window.cerebro
        .setPaneState(workspaceId, paneId, { version: 1, selectedId, filesOpen, filesWidth })
        .catch((error) => setError(String(error)))
    }, 200)
    return () => clearTimeout(timer)
  }, [workspaceId, paneId, selectedId, filesOpen, filesWidth])
  const items = query.data?.items ?? []

  const fileCount = entries.length

  const handleSelect = (itemId: string): void => {
    setScrollRequest({ id: itemId })
    setSelectedId(itemId)
    setCollapsedIds((current) => {
      const next = new Set(current)
      next.delete(itemId)
      return next
    })
  }

  const toggleCollapsed = useCallback((id: string): void => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleFiles = (): void => {
    setFilesOpen((current) => !current)
  }

  return (
    <WorkerPoolContextProvider
      poolOptions={changesWorkerPool}
      highlighterOptions={changesHighlighterOptions}
    >
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
          ) : error && !query.data ? (
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
          ) : (
            <Virtualizer style={SCROLL_STYLE} contentClassName="flex flex-col gap-1 pt-1 pb-4">
              {items.map((item) => (
                <ChangeFileContent
                  key={item.id}
                  item={item}
                  collapsed={collapsedIds.has(item.id)}
                  onToggle={toggleCollapsed}
                  renderAnnotation={renderAnnotation}
                  annotations={annotationsByItem?.[item.id]}
                />
              ))}
              <ChangeScrollTarget request={scrollRequest} />
            </Virtualizer>
          )}
        </div>
        <aside
          data-testid="changes-sidebar"
          data-state={filesOpen ? 'expanded' : 'collapsed'}
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
              {error && query.data && (
                <span
                  role="status"
                  className="max-w-48 truncate text-xs text-destructive"
                  title={error}
                >
                  Refresh failed: {error}
                </span>
              )}
              <DiffFoldControls
                onCollapseAll={() => setCollapsedIds(new Set(items.map((item) => item.id)))}
                onExpandAll={() => setCollapsedIds(new Set())}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    data-testid="changes-refresh"
                    aria-label="Refresh changes"
                    aria-busy={query.isFetching}
                    onClick={(): void => {
                      if (!query.isFetching) void query.refetch({ cancelRefetch: false })
                    }}
                  >
                    <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} />
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
    </WorkerPoolContextProvider>
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
