const pending = new Map<number, Promise<readonly string[]>>()

/** Loads the workspace file index once. Later searches reuse this promise. */
export function loadWorkspaceFiles(workspaceId: number): Promise<readonly string[]> {
  const existing = pending.get(workspaceId)
  if (existing) return existing
  const request = window.cerebro
    .listWorkspaceFiles(workspaceId)
    .then((files) => files)
    .catch(() => [] as string[])
  pending.set(workspaceId, request)
  return request
}
