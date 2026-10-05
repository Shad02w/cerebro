import { Circle, CircleCheck, CircleDot, Eye } from 'lucide-react'
import {
  isWorkspaceStatus,
  type Project,
  type Workspace,
  type WorkspaceStatus
} from '@shared/types'

export const WORKSPACE_STATUS_PRESENTATION: Record<
  WorkspaceStatus,
  {
    label: string
    iconClassName: string
    badgeClassName: string
    /** Section header text color and faint background used when the sidebar is grouped by status. */
    headerClassName: string
    Icon: typeof Circle
  }
> = {
  todo: {
    label: 'Todo',
    iconClassName: 'text-sidebar-foreground/70',
    badgeClassName: 'bg-sidebar-foreground/10',
    headerClassName:
      'bg-sidebar-foreground/[0.04] text-sidebar-foreground/80 hover:bg-sidebar-foreground/[0.08]',
    Icon: Circle
  },
  in_progress: {
    label: 'In progress',
    iconClassName: 'text-amber-500',
    badgeClassName: 'bg-amber-500/15',
    headerClassName:
      'bg-sidebar-foreground/[0.04] text-amber-700 hover:bg-sidebar-foreground/[0.08] dark:text-amber-400',
    Icon: CircleDot
  },
  ready_to_review: {
    label: 'Ready to review',
    iconClassName: 'text-emerald-500',
    badgeClassName: 'bg-emerald-500/15',
    headerClassName:
      'bg-sidebar-foreground/[0.04] text-emerald-700 hover:bg-sidebar-foreground/[0.08] dark:text-emerald-400',
    Icon: Eye
  },
  done: {
    label: 'Done',
    iconClassName: 'text-sky-500',
    badgeClassName: 'bg-sky-500/15',
    headerClassName:
      'bg-sidebar-foreground/[0.04] text-sky-700 hover:bg-sidebar-foreground/[0.08] dark:text-sky-400',
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
