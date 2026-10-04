import { useQueries } from '@tanstack/react-query'
import type { AgentHarness, AgentSession, PaneNode, WorkspaceTab } from '@cerebro/core'
import claudeIcon from '@/assets/agents/claude.svg'
import codexIcon from '@/assets/agents/codex.svg'
import piIcon from '@/assets/agents/pi.svg'
import { AgentStatusIcon } from '@/components/agent-status-icon'
import { harnessLabels } from './queries'

const icons: Record<AgentHarness, string> = {
  claude: claudeIcon,
  codex: codexIcon,
  pi: piIcon
}

function chatPaneIds(node: PaneNode): number[] {
  if (node.type === 'pane') return node.kind === 'chat' ? [node.id] : []
  return [...chatPaneIds(node.first), ...chatPaneIds(node.second)]
}

type TabSession = { harness: AgentHarness; status: AgentSession['status'] }

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
        view.session ? { harness: view.session.model.harness, status: view.session.status } : null
    }))
  })
  const session =
    sessions[paneIds.indexOf(tab.activePaneId)]?.data ?? sessions.find((entry) => entry.data)?.data
  if (!session) return null
  return (
    <span className="relative inline-flex size-4 shrink-0">
      <span
        role="img"
        aria-label={harnessLabels[session.harness]}
        data-testid="chat-tab-agent-icon"
        data-harness-icon={session.harness}
        className={`size-4 bg-current [mask-repeat:no-repeat] [mask-position:center] [mask-size:contain] ${session.harness === 'claude' ? 'text-[#D97757]' : ''}`}
        style={{ maskImage: `url("${icons[session.harness]}")` }}
      />
      {session.status === 'idle' ? null : (
        <AgentStatusIcon
          status={session.status}
          surface="tab"
          className="absolute -right-1 -bottom-1 rounded-[3px] bg-background p-px"
        />
      )}
    </span>
  )
}
