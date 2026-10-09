import type { FileDiffMetadata } from '@pierre/diffs'
import { queryOptions, type UseQueryOptions } from '@tanstack/react-query'
import type { FileDiffContents, WorkspaceChanges } from '@shared/types'
import { changeItemId } from './changes'
import { createChangesDiffWorker } from './changes-diff-worker'
import { queryClient } from './query-client'

export type LoadedChange = {
  id: string
  displayName: string
  diff: FileDiffContents
  fileDiff: FileDiffMetadata | null
}

export type ChangesSnapshot = { listed: WorkspaceChanges; items: LoadedChange[] }
const LOAD_CONCURRENCY = 4
// Closing and reopening a Changes pane should reuse its last review instead of reloading.
const CHANGES_GC_MS = 30 * 60_000
const PROGRESS_FLUSH_MS = 50

// Progress lives outside the refreshing query, so cancelling that query (hiding or closing
// the pane) does not revert the diffs that already finished loading.
queryClient.setQueryDefaults(['changes-progress'], { gcTime: CHANGES_GC_MS })

function sameContents(left: FileDiffContents, right: FileDiffContents): boolean {
  return (
    left.path === right.path &&
    left.oldPath === right.oldPath &&
    left.repositoryId === right.repositoryId &&
    left.status === right.status &&
    left.kind === right.kind &&
    left.oldContents === right.oldContents &&
    left.newContents === right.newContents &&
    left.oldImage?.dataUrl === right.oldImage?.dataUrl &&
    left.oldImage?.byteLength === right.oldImage?.byteLength &&
    left.newImage?.dataUrl === right.newImage?.dataUrl &&
    left.newImage?.byteLength === right.newImage?.byteLength
  )
}

export function changesManifestOptions(
  workspaceId: number,
  repositoryId?: number | null
): UseQueryOptions<WorkspaceChanges> {
  return queryOptions<WorkspaceChanges>({
    queryKey: ['changes-files', workspaceId, repositoryId ?? null] as const,
    queryFn: () => window.cerebro.listWorkspaceChanges(workspaceId, repositoryId),
    enabled: false,
    gcTime: CHANGES_GC_MS
  })
}

/** Files loaded so far by the latest refresh, in list order; shown before any refresh finishes. */
export function changesProgressOptions(
  workspaceId: number,
  repositoryId?: number | null
): UseQueryOptions<ChangesSnapshot> {
  return queryOptions<ChangesSnapshot>({
    queryKey: ['changes-progress', workspaceId, repositoryId ?? null] as const,
    queryFn: () => {
      throw new Error('Changes progress is written by the changes refresh.')
    },
    enabled: false,
    gcTime: CHANGES_GC_MS,
    structuralSharing: false
  })
}

export function changesOptions(
  workspaceId: number,
  repositoryId?: number | null
): UseQueryOptions<ChangesSnapshot> {
  const queryKey = ['changes', workspaceId, repositoryId ?? null] as const
  return queryOptions<ChangesSnapshot>({
    queryKey,
    staleTime: 0,
    gcTime: CHANGES_GC_MS,
    // Reuse files explicitly below instead of walking every parsed line on the UI thread.
    structuralSharing: false,
    queryFn: async ({ signal }): Promise<ChangesSnapshot> => {
      const previous = queryClient.getQueryData<ChangesSnapshot>(queryKey)
      const progressKey = changesProgressOptions(workspaceId, repositoryId).queryKey
      const progress = queryClient.getQueryData<ChangesSnapshot>(progressKey)
      const fetched = await window.cerebro.listWorkspaceChanges(workspaceId, repositoryId)
      signal.throwIfAborted()
      // The first visit can show filenames before any file contents have finished loading.
      // Share unchanged metadata too, so content-only edits do not rebuild the file tree.
      const listed =
        queryClient.setQueryData<WorkspaceChanges>(
          changesManifestOptions(workspaceId, repositoryId).queryKey,
          fetched
        ) ?? fetched
      const entries = listed.groups.flatMap((group) => group.files.map((file) => ({ group, file })))
      // Reuse finished work from the last complete refresh and from an interrupted one.
      const byId = new Map(previous?.items.map((item) => [item.id, item]))
      for (const item of progress?.items ?? []) byId.set(item.id, item)
      const items = new Array<LoadedChange>(entries.length)
      let flushTimer: ReturnType<typeof setTimeout> | undefined
      const flushProgress = (): void => {
        flushTimer = undefined
        const loaded = items.filter(Boolean)
        if (loaded.length > 0)
          queryClient.setQueryData<ChangesSnapshot>(progressKey, { listed, items: loaded })
      }
      const loadedItem = (index: number, item: LoadedChange): void => {
        items[index] = item
        flushTimer ??= setTimeout(flushProgress, PROGRESS_FLUSH_MS)
      }
      let parser: ReturnType<typeof createChangesDiffWorker> | undefined
      let nextIndex = 0
      let failed = false
      const consume = async (): Promise<void> => {
        try {
          while (nextIndex < entries.length && !failed) {
            signal.throwIfAborted()
            const index = nextIndex++
            const { group, file } = entries[index]
            const diff = await window.cerebro.getWorkspaceFileDiff(
              workspaceId,
              group.repositoryId,
              file
            )
            signal.throwIfAborted()
            if (failed) return
            const id = changeItemId(group.repositoryId, file.path)
            const displayName =
              listed.groups.length > 1 ? `${group.repositoryName}/${file.path}` : file.path
            const cached = byId.get(id)
            if (cached?.displayName === displayName && sameContents(cached.diff, diff)) {
              loadedItem(index, cached)
              continue
            }
            let fileDiff: FileDiffMetadata | null = null
            if (diff.kind === 'text' && (diff.oldContents != null || diff.newContents != null)) {
              parser ??= createChangesDiffWorker(signal)
              fileDiff = await parser.parse(
                diff.oldContents == null ? null : { name: displayName, contents: diff.oldContents },
                diff.newContents == null ? null : { name: displayName, contents: diff.newContents }
              )
            }
            loadedItem(index, { id, displayName, diff, fileDiff })
          }
        } catch (error) {
          failed = true
          throw error
        }
      }
      try {
        await Promise.all(
          Array.from({ length: Math.min(LOAD_CONCURRENCY, entries.length) }, consume)
        )
        signal.throwIfAborted()
        clearTimeout(flushTimer)
        flushTimer = undefined
        queryClient.setQueryData<ChangesSnapshot>(progressKey, { listed, items })
        if (
          previous &&
          items.length === previous.items.length &&
          items.every((item, index) => item === previous.items[index]) &&
          listed === previous.listed
        ) {
          return previous
        }
        return { listed, items }
      } finally {
        // Keep what finished before a cancellation or failure for the next refresh.
        if (flushTimer !== undefined) {
          clearTimeout(flushTimer)
          flushProgress()
        }
        parser?.dispose()
      }
    }
  })
}
