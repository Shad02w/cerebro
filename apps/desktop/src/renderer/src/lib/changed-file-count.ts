import type { WorkspaceChanges } from '@cerebro/core'

export type ChangedFileRow = {
  id: string
  label: string
}

/**
 * One row per changed file. A multi-root workspace keeps every nested repository
 * and prefixes paths so the total is still a single list.
 */
export function changedFileRows(changes: WorkspaceChanges | undefined): ChangedFileRow[] {
  if (!changes) return []
  const named = changes.groups.length > 1
  return changes.groups.flatMap((group) =>
    group.files.map((file) => ({
      id: `${group.repositoryId}:${file.path}`,
      label: named ? `${group.repositoryName}/${file.path}` : file.path
    }))
  )
}

/** File count for the workspace. Multi-root totals are the sum across nested repositories. */
export function changedFileCount(changes: WorkspaceChanges | undefined): number {
  return changedFileRows(changes).length
}
