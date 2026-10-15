import type { LayoutState, PaneNode } from '@cerebro/core'
import { acceptLayout, layoutOptions, queryClient } from '@/lib/query-client'

export type OpenAgentTarget = {
  sessionId: string
  workspaceId: number
  repositoryId: number | null
  paneId: number | null
  paneIds: number[]
  /** Session title. A reopened tab starts as "Agent" until this replaces that placeholder. */
  title?: string
}

function containsPane(node: PaneNode, paneId: number): boolean {
  if (node.type === 'pane') return node.id === paneId
  return containsPane(node.first, paneId) || containsPane(node.second, paneId)
}

/** Pane in the active tab when one is bound there, otherwise the highest bound pane. */
export function preferredPaneId(
  target: OpenAgentTarget,
  layout: LayoutState | undefined
): number | null {
  const paneIds = target.paneIds.length
    ? target.paneIds
    : target.paneId != null
      ? [target.paneId]
      : []
  if (!paneIds.length) return null
  const workspace = layout?.workspaces[target.workspaceId]
  const tab = workspace?.tabs.find((item) => item.id === workspace.activeTabId)
  if (tab) {
    if (paneIds.includes(tab.activePaneId)) return tab.activePaneId
    const inTab = paneIds.find((paneId) => containsPane(tab.root, paneId))
    if (inTab != null) return inTab
  }
  return paneIds[0] ?? null
}

/**
 * Focus the pane that already shows the session. Otherwise select the workspace,
 * create an Agent tab, and bind the saved session.
 */
export async function openAgentSession(
  target: OpenAgentTarget,
  onSelectWorkspace: (workspaceId: number) => void
): Promise<void> {
  onSelectWorkspace(target.workspaceId)
  const layout = queryClient.getQueryData<LayoutState>(layoutOptions.queryKey)
  const paneId = preferredPaneId(target, layout)
  if (paneId != null) {
    const reply = await window.cerebro.layoutCommand({
      target: 'pane',
      action: 'focus',
      workspaceId: target.workspaceId,
      paneId
    })
    acceptLayout(reply.state)
    return
  }
  const reply = await window.cerebro.layoutCommand({
    target: 'tab',
    action: 'create',
    kind: 'chat',
    workspaceId: target.workspaceId,
    focus: true,
    ...(target.repositoryId != null ? { repositoryId: target.repositoryId } : {})
  })
  acceptLayout(reply.state)
  const created = reply.result as { activePaneId?: number } | null
  if (!created || created.activePaneId == null) throw new Error('Could not open an Agent tab.')
  await window.cerebro.chatCommand({
    action: 'open',
    workspaceId: target.workspaceId,
    paneId: created.activePaneId,
    sessionId: target.sessionId
  })
  const label = target.title?.trim()
  if (!label || label === 'Agent') return
  const renamed = await window.cerebro.layoutCommand({
    target: 'tab',
    action: 'rename',
    workspaceId: target.workspaceId,
    paneId: created.activePaneId,
    label
  })
  acceptLayout(renamed.state)
}
