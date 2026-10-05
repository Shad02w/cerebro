import type { Workspace, WorkspaceStatus } from '@shared/types'
import { WORKSPACE_STATUSES, isWorkspaceStatus } from '@shared/types'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
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

export function WorkspaceStatusMenu({
  workspace,
  onSetStatus
}: {
  workspace: Workspace
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
}): React.JSX.Element {
  const current = workspaceStatus(workspace.status)
  return (
    <>
      <DropdownMenuLabel>Status</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={current}
        onValueChange={(value): void => {
          if (!isWorkspaceStatus(value) || value === current) return
          onSetStatus(workspace.id, value)
        }}
      >
        {WORKSPACE_STATUSES.map((status) => {
          const presentation = WORKSPACE_STATUS_PRESENTATION[status]
          return (
            <DropdownMenuRadioItem
              key={status}
              value={status}
              data-testid={`workspace-status-option-${workspace.id}-${status}`}
              onClick={(event): void => event.stopPropagation()}
            >
              <WorkspaceStatusIcon status={status} />
              {presentation.label}
            </DropdownMenuRadioItem>
          )
        })}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
    </>
  )
}
