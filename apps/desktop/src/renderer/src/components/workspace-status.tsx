import { Check } from 'lucide-react'
import type { Workspace, WorkspaceStatus } from '@shared/types'
import { WORKSPACE_STATUSES } from '@shared/types'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { WORKSPACE_STATUS_PRESENTATION, workspaceStatus } from '@/lib/workspace-status'

export function WorkspaceStatusIcon({
  status,
  className
}: {
  status: WorkspaceStatus
  className?: string
}): React.JSX.Element {
  const presentation = WORKSPACE_STATUS_PRESENTATION[status]
  const Icon = presentation.Icon
  return (
    <span
      title={presentation.label}
      data-workspace-status-icon={status}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full',
        presentation.badgeClassName,
        className
      )}
    >
      <Icon aria-hidden className={cn('size-3', presentation.iconClassName)} />
    </span>
  )
}

function StatusChoices({
  workspace,
  onSetStatus,
  Item
}: {
  workspace: Workspace
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
  Item: typeof DropdownMenuItem | typeof ContextMenuItem
}): React.JSX.Element {
  const current = workspaceStatus(workspace.status)
  return (
    <>
      {WORKSPACE_STATUSES.map((status) => {
        const presentation = WORKSPACE_STATUS_PRESENTATION[status]
        const selected = status === current
        return (
          <Item
            key={status}
            data-testid={`workspace-status-option-${workspace.id}-${status}`}
            data-current={selected ? 'true' : 'false'}
            onClick={(event): void => event.stopPropagation()}
            onSelect={(): void => {
              if (!selected) onSetStatus(workspace.id, status)
            }}
          >
            <WorkspaceStatusIcon status={status} />
            <span className="min-w-0 flex-1 truncate">{presentation.label}</span>
            {selected ? <Check aria-hidden /> : null}
          </Item>
        )
      })}
    </>
  )
}

export function WorkspaceStatusMenu({
  workspace,
  onSetStatus
}: {
  workspace: Workspace
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
}): React.JSX.Element {
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger data-testid={`workspace-move-status-menu-${workspace.id}`}>
          Move to status
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-48">
          <StatusChoices workspace={workspace} onSetStatus={onSetStatus} Item={DropdownMenuItem} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
    </>
  )
}

export function WorkspaceStatusContextMenu({
  workspace,
  onSetStatus,
  children,
  ...triggerProps
}: {
  workspace: Workspace | null
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
  children: React.ReactElement
} & Omit<
  React.ComponentProps<typeof ContextMenuTrigger>,
  'asChild' | 'children'
>): React.JSX.Element {
  if (!workspace) return children
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild {...triggerProps}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid={`workspace-move-status-${workspace.id}`}>
            Move to status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <StatusChoices workspace={workspace} onSetStatus={onSetStatus} Item={ContextMenuItem} />
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}
