import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ChatAgentActivity, LayoutState, PaneNode } from '@cerebro/core'
import { HarnessIcon } from '@/components/harness-icon'
import { harnessLabels } from '@/components/chat/queries'
import { defaultChatTabLabel } from '@/lib/thread-tab-title'
import { agentStatusLabel } from '@/lib/agent-status-text'
import { sortAgentActivity } from '@/lib/agent-activity'
import { layoutOptions } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar'

const OPEN_SESSION_CAP = 8

function containsPane(node: PaneNode, paneId: number): boolean {
  if (node.type === 'pane') return node.id === paneId
  return containsPane(node.first, paneId) || containsPane(node.second, paneId)
}

function sessionTitle(agent: ChatAgentActivity, layout: LayoutState | undefined): string {
  const fallback = agent.title.trim() || harnessLabels[agent.harness]
  const paneIds = agent.paneIds.length ? agent.paneIds : agent.paneId != null ? [agent.paneId] : []
  if (!layout || !paneIds.length) return fallback
  const workspace = layout.workspaces[agent.workspaceId]
  const active = workspace?.tabs.find((tab) => tab.id === workspace.activeTabId)
  const ordered = active
    ? paneIds.toSorted(
        (a, b) => Number(containsPane(active.root, b)) - Number(containsPane(active.root, a))
      )
    : paneIds
  for (const paneId of ordered) {
    const label = workspace?.tabs.find((tab) => containsPane(tab.root, paneId))?.label.trim()
    if (label && label !== defaultChatTabLabel) return label
  }
  return fallback
}

function sessionIsActive(
  agent: ChatAgentActivity,
  layout: LayoutState | undefined,
  activeWorkspaceId: number | null
): boolean {
  if (activeWorkspaceId !== agent.workspaceId || !layout) return false
  const workspace = layout.workspaces[agent.workspaceId]
  const tab = workspace?.tabs.find((item) => item.id === workspace.activeTabId)
  if (!tab) return false
  const paneIds = agent.paneIds.length ? agent.paneIds : agent.paneId != null ? [agent.paneId] : []
  return paneIds.includes(tab.activePaneId)
}

export function WorkspaceSessionList({
  agents,
  activeWorkspaceId,
  muted = false,
  onOpenAgent
}: {
  agents: ChatAgentActivity[]
  activeWorkspaceId: number | null
  muted?: boolean
  onOpenAgent: (agent: ChatAgentActivity) => void
}): React.JSX.Element | null {
  const layout = useQuery(layoutOptions).data
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const running = agents.some((agent) => agent.status === 'running')
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  if (!agents.length) return null
  const sorted = sortAgentActivity(agents)
  const visible = expanded ? sorted : sorted.slice(0, OPEN_SESSION_CAP)
  const hidden = sorted.length - visible.length
  return (
    <SidebarMenuSub data-testid="workspace-sessions" className="mr-0">
      {visible.map((agent) => {
        const title = sessionTitle(agent, layout)
        const label = agentStatusLabel(agent, now)
        const model = agent.modelLabel.trim() || harnessLabels[agent.harness]
        return (
          <SidebarMenuSubItem key={agent.sessionId}>
            <SidebarMenuSubButton
              isActive={sessionIsActive(agent, layout, activeWorkspaceId)}
              className={cn(
                'h-auto flex-col items-stretch gap-0.5 py-1 pr-2',
                muted && 'text-sidebar-foreground/55'
              )}
              render={
                <button
                  type="button"
                  data-testid="workspace-agent-open"
                  data-agent-title={title}
                  data-agent-harness={agent.harness}
                  aria-label={title}
                  onClick={(): void => onOpenAgent(agent)}
                />
              }
            >
              <span className="flex w-full min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px]">{title}</span>
                {label ? (
                  <span
                    data-workspace-agent-status={agent.status}
                    aria-label={label.aria}
                    className={cn(
                      'shrink-0 text-right text-[11px] leading-4 tabular-nums',
                      label.color
                    )}
                  >
                    {label.text}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  'flex w-full min-w-0 items-center gap-1 text-[11px] leading-4',
                  muted ? 'text-sidebar-foreground/40' : 'text-sidebar-foreground/65'
                )}
              >
                <HarnessIcon harness={agent.harness} className="size-3.5" />
                <span className="min-w-0 truncate">{model}</span>
              </span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        )
      })}
      {hidden > 0 ? (
        <SidebarMenuSubItem>
          <button
            type="button"
            className="h-7 w-full rounded-md px-2 text-left text-[11px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            data-testid="workspace-sessions-more"
            onClick={(): void => setExpanded(true)}
          >
            Show {hidden} more
          </button>
        </SidebarMenuSubItem>
      ) : null}
    </SidebarMenuSub>
  )
}
