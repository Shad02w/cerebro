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

type ChangesSnapshot = { listed: WorkspaceChanges; items: LoadedChange[] }
const LOAD_CONCURRENCY = 4

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
    enabled: false
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
    gcTime: 5 * 60_000,
    // Reuse files explicitly below instead of walking every parsed line on the UI thread.
    structuralSharing: false,
    queryFn: async ({ signal }): Promise<ChangesSnapshot> => {
      const previous = queryClient.getQueryData<ChangesSnapshot>(queryKey)
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
      const byId = new Map(previous?.items.map((item) => [item.id, item]))
      const items = new Array<LoadedChange>(entries.length)
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
              items[index] = cached
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
            items[index] = { id, displayName, diff, fileDiff }
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
        parser?.dispose()
      }
    }
  })
}
