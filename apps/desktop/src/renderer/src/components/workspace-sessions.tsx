import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import type { ChatAgentActivity, LayoutState, PaneNode } from '@cerebro/core'
import { AgentStatusIcon } from '@/components/agent-status-icon'
import { HarnessIcon } from '@/components/harness-icon'
import { harnessLabels } from '@/components/chat/queries'
import { defaultChatTabLabel } from '@/lib/thread-tab-title'
import { sortAgentActivity } from '@/lib/agent-activity'
import { acceptLayout, layoutOptions } from '@/lib/query-client'
import { cn } from '@/lib/utils'

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

function closeSession(agent: ChatAgentActivity, layout: LayoutState | undefined): void {
  const paneId = agent.paneId
  if (paneId == null || !layout) return
  const workspace = layout.workspaces[agent.workspaceId]
  const tab = workspace?.tabs.find((item) => containsPane(item.root, paneId))
  if (!tab) return
  void window.cerebro
    .layoutCommand({
      target: 'pane',
      action: 'close',
      workspaceId: agent.workspaceId,
      tabId: tab.id,
      paneId
    })
    .then((reply) => acceptLayout(reply.state))
}

export function WorkspaceSessionList({
  agents,
  muted = false,
  onOpenAgent
}: {
  agents: ChatAgentActivity[]
  muted?: boolean
  onOpenAgent: (agent: ChatAgentActivity) => void
}): React.JSX.Element | null {
  const layout = useQuery(layoutOptions).data
  const [expanded, setExpanded] = useState(false)
  if (!agents.length) return null
  const sorted = sortAgentActivity(agents)
  const visible = expanded ? sorted : sorted.slice(0, OPEN_SESSION_CAP)
  const hidden = sorted.length - visible.length
  return (
    <div data-testid="workspace-sessions" className="flex flex-col bg-transparent px-2 pb-1.5">
      {visible.map((agent) => {
        const title = sessionTitle(agent, layout)
        const model = agent.modelLabel.trim() || harnessLabels[agent.harness]
        return (
          <div
            key={agent.sessionId}
            className={cn('flex items-start gap-0.5 bg-transparent py-0.5', muted && 'opacity-60')}
          >
            <button
              type="button"
              data-testid="workspace-agent-open"
              data-agent-title={title}
              data-agent-harness={agent.harness}
              aria-label={title}
              className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-selected"
              onClick={(): void => onOpenAgent(agent)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {agent.status === 'idle' ? (
                  <span className="size-3.5 shrink-0" />
                ) : (
                  <AgentStatusIcon status={agent.status} surface="sidebar" className="size-3.5" />
                )}
                <HarnessIcon harness={agent.harness} className="size-3.5 shrink-0" />
                <span data-session-title="" className="min-w-0 flex-1 truncate text-[13px]">
                  {title}
                </span>
                <span
                  data-session-model=""
                  className={cn(
                    'max-w-24 shrink-0 truncate text-[11px]',
                    muted ? 'text-sidebar-foreground/40' : 'text-sidebar-foreground/55'
                  )}
                >
                  {model}
                </span>
              </span>
              {agent.preview ? (
                <span
                  className={cn(
                    'truncate pl-[2.375rem] text-[11px] leading-4',
                    muted ? 'text-sidebar-foreground/35' : 'text-sidebar-foreground/55'
                  )}
                >
                  {agent.preview}
                </span>
              ) : null}
            </button>
            {agent.paneId != null ? (
              <button
                type="button"
                data-testid="workspace-agent-close"
                aria-label={`Close ${title}`}
                className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={(event): void => {
                  event.stopPropagation()
                  closeSession(agent, layout)
                }}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
        )
      })}
      {hidden > 0 ? (
        <button
          type="button"
          className="h-7 w-full rounded-md px-2 text-left text-[11px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          data-testid="workspace-sessions-more"
          onClick={(): void => setExpanded(true)}
        >
          Show {hidden} more
        </button>
      ) : null}
    </div>
  )
}
