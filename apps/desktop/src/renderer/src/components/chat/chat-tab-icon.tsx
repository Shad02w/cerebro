import type { PaneNode, WorkspaceTab } from '@cerebro/core'
import { HarnessIcon, HarnessStatusIcon } from '@/components/harness-icon'
import { useAgentActivity } from '@/lib/agent-activity'

function chatPaneIds(node: PaneNode): number[] {
  if (node.type === 'pane') return node.kind === 'chat' ? [node.id] : []
  return [...chatPaneIds(node.first), ...chatPaneIds(node.second)]
}

/**
 * Reads the shared sidebar overview, not each pane's transcript, so background tabs cost no
 * per-pane mux request while their agents stream.
 */
export function ChatTabIcon({
  workspaceId,
  tab
}: {
  workspaceId: number
  tab: WorkspaceTab
}): React.JSX.Element | null {
  const agents = useAgentActivity().get(workspaceId) ?? []
  const paneIds = chatPaneIds(tab.root)
  const forPane = (paneId: number): (typeof agents)[number] | undefined =>
    agents.find((agent) => agent.paneIds.includes(paneId))
  const session =
    (paneIds.includes(tab.activePaneId) ? forPane(tab.activePaneId) : undefined) ??
    paneIds.map(forPane).find(Boolean)
  if (!session) return null
  if (session.status === 'idle') {
    return <HarnessIcon harness={session.harness} testId="chat-tab-agent-icon" />
  }
  return (
    <HarnessStatusIcon
      harness={session.harness}
      status={session.status}
      surface="tab"
      testId="chat-tab-agent-icon"
    />
  )
}
