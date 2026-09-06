import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  parseDiffFromFile,
  type CodeViewItem,
  type DiffLineAnnotation,
  type LineAnnotation
} from '@pierre/diffs'
import { CodeView, type CodeViewHandle, type CodeViewReactOptions } from '@pierre/diffs/react'
import { FolderTree, List, RefreshCw } from 'lucide-react'
import type {
  ChangedFile,
  FileDiffContents,
  RepoChangeGroup,
  WorkspaceChanges
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChangesFileList, type ChangesListMode } from '@/components/changes-file-list'
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
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  stickyHeaders: true,
  layout: { paddingTop: 8, paddingBottom: 16, gap: 12 }
}

const CODE_VIEW_STYLE = { height: '100%', overflow: 'auto' } as const

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
  const [mode, setMode] = useState<ChangesListMode>('flat')
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

  return (
    <div
      data-testid="changes-view"
      data-workspace-id={workspaceId}
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
        className="flex w-56 shrink-0 flex-col border-l border-border bg-background"
      >
        <div className="flex items-center gap-1 border-b border-border px-1.5 py-1">
          <span className="min-w-0 flex-1 truncate px-1 text-[11px] font-medium text-muted-foreground">
            Files
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-testid="changes-mode-flat"
                aria-label="Flat list"
                aria-pressed={mode === 'flat'}
                className={cn(mode === 'flat' && 'bg-muted')}
                onClick={(): void => setMode('flat')}
              >
                <List className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Flat</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-testid="changes-mode-tree"
                aria-label="Tree list"
                aria-pressed={mode === 'tree'}
                className={cn(mode === 'tree' && 'bg-muted')}
                onClick={(): void => setMode('tree')}
              >
                <FolderTree className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Tree</TooltipContent>
          </Tooltip>
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
        </div>
        {loading ? (
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
            mode={mode}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        )}
      </aside>
    </div>
  )
}
