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
    /** Tinted section header used when the sidebar is grouped by status. */
    headerClassName: string
    Icon: typeof Circle
  }
> = {
  todo: {
    label: 'Todo',
    iconClassName: 'text-sidebar-foreground/70',
    badgeClassName: 'bg-sidebar-foreground/10',
    headerClassName:
      'bg-sidebar-foreground/[0.07] text-sidebar-foreground/80 hover:bg-sidebar-foreground/12',
    Icon: Circle
  },
  in_progress: {
    label: 'In progress',
    iconClassName: 'text-amber-500',
    badgeClassName: 'bg-amber-500/15',
    headerClassName: 'bg-amber-500/10 text-amber-700 hover:bg-amber-500/18 dark:text-amber-400',
    Icon: CircleDot
  },
  ready_to_review: {
    label: 'Ready to review',
    iconClassName: 'text-emerald-500',
    badgeClassName: 'bg-emerald-500/15',
    headerClassName:
      'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/18 dark:text-emerald-400',
    Icon: Eye
  },
  done: {
    label: 'Done',
    iconClassName: 'text-sky-500',
    badgeClassName: 'bg-sky-500/15',
    headerClassName: 'bg-sky-500/10 text-sky-700 hover:bg-sky-500/18 dark:text-sky-400',
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
