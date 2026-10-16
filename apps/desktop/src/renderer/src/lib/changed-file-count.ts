import type { WorkspaceChanges } from '@cerebro/core'

export type DiffStat = {
  additions: number
  deletions: number
}

/** One `+N -M` for the workspace. Multi-root totals sum every nested repository. */
export function workspaceDiffStat(changes: WorkspaceChanges | undefined): DiffStat {
  const stat = { additions: 0, deletions: 0 }
  if (!changes) return stat
  for (const group of changes.groups) {
    for (const file of group.files) {
      stat.additions += file.additions ?? 0
      stat.deletions += file.deletions ?? 0
    }
  }
  return stat
}
