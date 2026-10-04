import { useQueries } from '@tanstack/react-query'
import {
  agentActivityStatus,
  type AgentActivityStatus,
  type AgentHarness,
  type PaneNode,
  type WorkspaceTab
} from '@cerebro/core'
import { HarnessIcon, HarnessStatusIcon } from '@/components/harness-icon'

function chatPaneIds(node: PaneNode): number[] {
  if (node.type === 'pane') return node.kind === 'chat' ? [node.id] : []
  return [...chatPaneIds(node.first), ...chatPaneIds(node.second)]
}

type TabSession = { harness: AgentHarness; status: AgentActivityStatus }

export function ChatTabIcon({
  workspaceId,
  tab
}: {
  workspaceId: number
  tab: WorkspaceTab
}): React.JSX.Element | null {
  const paneIds = chatPaneIds(tab.root)
  const sessions = useQueries({
    queries: paneIds.map((paneId) => ({
      queryKey: ['chat', workspaceId, paneId],
      queryFn: () => window.cerebro.chatCommand({ action: 'get', workspaceId, paneId }),
      staleTime: Infinity,
      select: (view: Awaited<ReturnType<typeof window.cerebro.chatCommand>>): TabSession | null =>
        view.session
          ? {
              harness: view.session.model.harness,
              status: agentActivityStatus(view.session)
            }
          : null
    }))
  })
  const session =
    sessions[paneIds.indexOf(tab.activePaneId)]?.data ?? sessions.find((entry) => entry.data)?.data
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
