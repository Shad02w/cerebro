import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { groupThreadRows, type ThreadRow, type ThreadRowStatus } from '@cerebro/core'
import type { Project, Workspace } from '@shared/types'
import { HarnessIcon } from '@/components/harness-icon'
import { WorkspaceHoverCard } from '@/components/workspace-hover-card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

const THREAD_STATUS_PRESENTATION: Record<
  ThreadRowStatus,
  { label: string; headerClassName: string; labelClassName: string; dotClassName: string }
> = {
  'request user': {
    label: 'Request user',
    headerClassName:
      'bg-sidebar-foreground/[0.04] text-amber-700 hover:bg-sidebar-foreground/[0.08] dark:text-amber-400',
    labelClassName: 'text-amber-700 dark:text-amber-400',
    dotClassName: 'bg-amber-500'
  },
  'agent working': {
    label: 'Agent working',
    headerClassName:
      'bg-sidebar-foreground/[0.04] text-sky-700 hover:bg-sidebar-foreground/[0.08] dark:text-sky-400',
    labelClassName: 'text-sky-700 dark:text-sky-400',
    dotClassName: 'bg-sky-500'
  },
  'waiting for review': {
    label: 'Waiting for review',
    headerClassName:
      'bg-sidebar-foreground/[0.04] text-emerald-700 hover:bg-sidebar-foreground/[0.08] dark:text-emerald-400',
    labelClassName: 'text-emerald-700 dark:text-emerald-400',
    dotClassName: 'bg-emerald-500'
  },
  'in progress': {
    label: 'In progress',
    headerClassName:
      'bg-sidebar-foreground/[0.04] text-amber-700 hover:bg-sidebar-foreground/[0.08] dark:text-amber-400',
    labelClassName: 'text-amber-700 dark:text-amber-400',
    dotClassName: 'bg-amber-400'
  },
  done: {
    label: 'Done',
    headerClassName:
      'bg-sidebar-foreground/[0.04] text-sidebar-foreground/80 hover:bg-sidebar-foreground/[0.08]',
    labelClassName: 'text-sidebar-foreground/70',
    dotClassName: 'bg-sky-500'
  }
}

function workspaceFor(projects: Project[], workspaceId: number): Workspace | undefined {
  for (const project of projects) {
    const workspace = project.workspaces.find((item) => item.id === workspaceId)
    if (workspace) return workspace
  }
  return undefined
}

function statusSlug(status: ThreadRowStatus): string {
  return status.replace(/ /g, '-')
}

function ThreadGroup({
  status,
  rows,
  projects,
  activePaneId,
  onOpen
}: {
  status: ThreadRowStatus
  rows: ThreadRow[]
  projects: Project[]
  activePaneId: number | null
  onOpen: (row: ThreadRow) => void
}): React.JSX.Element {
  const presentation = THREAD_STATUS_PRESENTATION[status]
  const [open, setOpen] = useState(true)
  const slug = statusSlug(status)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              className={cn(
                'group/status-header app-no-drag h-8 pr-2! text-[11px] font-semibold tracking-wider uppercase',
                presentation.headerClassName
              )}
              data-testid={`thread-group-${slug}`}
              data-thread-status={status}
              aria-label={`${presentation.label}, ${rows.length} ${rows.length === 1 ? 'thread' : 'threads'}`}
            />
          }
        >
          <span
            aria-hidden
            className={cn('size-1.5 shrink-0 rounded-full', presentation.dotClassName)}
          />
          <span className="min-w-0 flex-1 truncate">{presentation.label}</span>
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-focus-visible/status-header:opacity-70 group-hover/status-header:opacity-70 group-data-panel-open/status-header:rotate-90"
          />
          <span
            className="min-w-5 rounded-full bg-sidebar-foreground/10 px-1.5 text-center text-[11px] font-medium tracking-normal text-sidebar-foreground tabular-nums"
            data-testid={`thread-count-${slug}`}
          >
            {rows.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex min-w-0 flex-col gap-1.5 py-1" data-testid={`thread-rows-${slug}`}>
            {rows.map((row) => {
              const active = row.paneId != null && row.paneId === activePaneId
              const button = (
                <button
                  type="button"
                  className={cn(
                    'app-no-drag flex w-full min-w-0 flex-col gap-0.5 rounded-md border border-sidebar-border/80 bg-sidebar px-2.5 py-2 text-left',
                    'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    active && 'bg-sidebar-accent ring-1 ring-sidebar-ring'
                  )}
                  data-testid={`thread-row-${row.id}`}
                  data-thread-status={row.status}
                  data-thread-open={row.open ? 'true' : 'false'}
                  data-workspace-id={row.workspaceId}
                  aria-current={active ? 'location' : undefined}
                  aria-label={`${row.title}, ${row.location}, ${presentation.label}`}
                  onClick={() => onOpen(row)}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-sidebar-foreground/70">
                    <HarnessIcon harness={row.harness} className="size-3.5" />
                    <span className="min-w-0 flex-1 truncate" data-testid="thread-location">
                      {row.location}
                    </span>
                    <span
                      className={cn('shrink-0 font-medium', presentation.labelClassName)}
                      data-testid="thread-status"
                    >
                      {presentation.label}
                    </span>
                  </span>
                  <span
                    className="truncate text-[13px] font-medium leading-4 text-sidebar-foreground"
                    data-testid="thread-title"
                  >
                    {row.title}
                  </span>
                  {row.description ? (
                    <span
                      className="truncate text-[11px] leading-4 text-sidebar-foreground/60"
                      data-testid="thread-description"
                    >
                      {row.description}
                    </span>
                  ) : null}
                </button>
              )
              return (
                <li key={row.id} className="min-w-0">
                  <WorkspaceHoverCard workspace={workspaceFor(projects, row.workspaceId)}>
                    {button}
                  </WorkspaceHoverCard>
                </li>
              )
            })}
          </ul>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

export function ThreadList({
  rows,
  projects,
  activePaneId,
  searching,
  onOpen
}: {
  rows: ThreadRow[]
  projects: Project[]
  activePaneId: number | null
  searching: boolean
  onOpen: (row: ThreadRow) => void
}): React.JSX.Element {
  const groups = groupThreadRows(rows)
  return (
    <div data-testid="thread-list">
      {searching ? (
        <p role="status" className="px-2 pt-1 pb-2 text-xs text-sidebar-foreground/60">
          {rows.length === 0
            ? 'No matching threads'
            : `${rows.length} ${rows.length === 1 ? 'thread' : 'threads'} found`}
        </p>
      ) : null}
      {groups.length === 0 ? (
        <p className={cn('px-2 py-1.5 text-xs text-sidebar-foreground/60', searching && 'hidden')}>
          No threads yet. Send a message from an Agent pane to start one.
        </p>
      ) : (
        <SidebarMenu className="gap-1" data-testid="sidebar-threads">
          {groups.map((group) => (
            <ThreadGroup
              key={group.status}
              status={group.status}
              rows={group.rows}
              projects={projects}
              activePaneId={activePaneId}
              onOpen={onOpen}
            />
          ))}
        </SidebarMenu>
      )}
    </div>
  )
}
