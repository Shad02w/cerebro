import { workspaceMatchingPath } from '@/lib/workspace-status'

const pending = new Map<string, Promise<number | null>>()

function checkoutKey(localPath: string): string {
  return localPath.replace(/[\\/]+$/, '')
}

/**
 * The workspace for a nested git checkout. Registers one when the row is used
 * before that checkout has its own workspace.
 */
export function ensureWorkspaceForCheckout(localPath: string): Promise<number | null> {
  const key = checkoutKey(localPath)
  if (!key) return Promise.resolve(null)
  const existing = pending.get(key)
  if (existing) return existing
  const created = resolveWorkspaceForCheckout(localPath).finally(() => {
    if (pending.get(key) === created) pending.delete(key)
  })
  pending.set(key, created)
  return created
}

async function resolveWorkspaceForCheckout(localPath: string): Promise<number | null> {
  const listed = await window.cerebro.listProjects()
  const found = workspaceMatchingPath(listed.projects, localPath)
  if (found) return found.id
  try {
    const project = await window.cerebro.createProjectFromDirectory(localPath)
    const created = workspaceMatchingPath([project], localPath)
    if (created) return created.id
  } catch {
    // Registered between the list and the create, or the checkout could not be opened.
  }
  const again = await window.cerebro.listProjects()
  return workspaceMatchingPath(again.projects, localPath)?.id ?? null
}
