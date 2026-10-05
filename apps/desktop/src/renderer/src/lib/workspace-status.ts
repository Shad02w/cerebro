import { Circle, CircleCheck, CircleDot, Eye } from 'lucide-react'
import {
  isWorkspaceStatus,
  type Project,
  type Workspace,
  type WorkspaceStatus
} from '@shared/types'

export const WORKSPACE_STATUS_PRESENTATION: Record<
  WorkspaceStatus,
  { label: string; iconClassName: string; badgeClassName: string; Icon: typeof Circle }
> = {
  todo: {
    label: 'Todo',
    iconClassName: 'text-sidebar-foreground/70',
    badgeClassName: 'bg-sidebar-foreground/10',
    Icon: Circle
  },
  in_progress: {
    label: 'In progress',
    iconClassName: 'text-amber-500',
    badgeClassName: 'bg-amber-500/15',
    Icon: CircleDot
  },
  ready_to_review: {
    label: 'Ready to review',
    iconClassName: 'text-emerald-500',
    badgeClassName: 'bg-emerald-500/15',
    Icon: Eye
  },
  done: {
    label: 'Done',
    iconClassName: 'text-sky-500',
    badgeClassName: 'bg-sky-500/15',
    Icon: CircleCheck
  }
}

export function workspaceStatus(status: unknown): WorkspaceStatus {
  return isWorkspaceStatus(status) ? status : 'todo'
}

/** Status lives on a normal workspace row, or on the multi-root root row. */
export function workspaceCarriesStatus(project: Project, workspace: Workspace): boolean {
  const multiRoot = project.kind === 'multi-root' || project.repositories.length > 1
  return !multiRoot || workspace.kind === 'root'
}
