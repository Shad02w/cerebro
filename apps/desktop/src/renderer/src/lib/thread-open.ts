import type { LayoutState, Pane, PaneNode, ThreadRow } from '@cerebro/core'
import { acceptLayout } from '@/lib/query-client'

function leaves(node: PaneNode): Pane[] {
  return node.type === 'pane' ? [node] : [...leaves(node.first), ...leaves(node.second)]
}

/** Focus the pane that already shows this session, or bind it to a chat pane in its workspace. */
export async function openSavedThread(row: ThreadRow): Promise<void> {
  if (row.paneId != null) {
    const reply = await window.cerebro.layoutCommand({
      target: 'pane',
      action: 'focus',
      workspaceId: row.workspaceId,
      paneId: row.paneId
    })
    acceptLayout(reply.state)
    return
  }
  const current = acceptLayout(await window.cerebro.getLayout())
  const workspace = current.workspaces[row.workspaceId]
  const activeTab = workspace?.tabs.find((tab) => tab.id === workspace.activeTabId)
  const activePane =
    activeTab && leaves(activeTab.root).find((pane) => pane.id === activeTab.activePaneId)
  const reusable =
    activePane?.kind === 'chat' &&
    (row.repositoryId == null ||
      activePane.repositoryId == null ||
      activePane.repositoryId === row.repositoryId)
      ? activePane.id
      : undefined
  let paneId = reusable
  if (paneId == null) {
    const reply = await window.cerebro.layoutCommand({
      target: 'tab',
      action: 'create',
      kind: 'chat',
      workspaceId: row.workspaceId,
      focus: true,
      ...(row.repositoryId != null ? { repositoryId: row.repositoryId } : {})
    })
    acceptLayout(reply.state)
    paneId = (reply.result as { activePaneId?: number }).activePaneId
  }
  if (paneId == null) return
  await window.cerebro.chatCommand({
    action: 'open',
    workspaceId: row.workspaceId,
    paneId,
    sessionId: row.id
  })
}

export function activePaneIdFor(
  layout: LayoutState | undefined,
  workspaceId: number | null
): number | null {
  if (workspaceId == null || !layout) return null
  const workspace = layout.workspaces[workspaceId]
  return workspace?.tabs.find((tab) => tab.id === workspace.activeTabId)?.activePaneId ?? null
}
