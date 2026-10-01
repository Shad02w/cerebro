import { useQueries } from '@tanstack/react-query'
import type { AgentHarness, PaneNode, WorkspaceTab } from '@cerebro/core'
import claudeIcon from '@/assets/agents/claude.svg'
import codexIcon from '@/assets/agents/codex.svg'
import piIcon from '@/assets/agents/pi.svg'
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
      select: (view: Awaited<ReturnType<typeof window.cerebro.chatCommand>>) =>
        view.session?.model.harness
    }))
  })
  const harness =
    sessions[paneIds.indexOf(tab.activePaneId)]?.data ??
    sessions.find((session) => session.data)?.data
  if (!harness) return null
  return (
    <span
      role="img"
      aria-label={harnessLabels[harness]}
      data-testid="chat-tab-agent-icon"
      data-harness-icon={harness}
      className={`size-4 shrink-0 bg-current [mask-repeat:no-repeat] [mask-position:center] [mask-size:contain] ${harness === 'claude' ? 'text-[#D97757]' : ''}`}
      style={{ maskImage: `url("${icons[harness]}")` }}
    />
  )
}
