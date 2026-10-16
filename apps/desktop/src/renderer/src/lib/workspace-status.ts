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
    /** Section header text color when the sidebar is grouped by status. */
    headerClassName: string
    Icon: typeof Circle
  }
> = {
  todo: {
    label: 'Todo',
    iconClassName: 'text-sky-500',
    badgeClassName: 'bg-sky-500/15',
    headerClassName:
      'text-sky-700 hover:text-sky-700 active:text-sky-700 dark:text-sky-400 dark:hover:text-sky-400 dark:active:text-sky-400',
    Icon: Circle
  },
  in_progress: {
    label: 'In progress',
    iconClassName: 'text-amber-500',
    badgeClassName: 'bg-amber-500/15',
    headerClassName:
      'text-amber-700 hover:text-amber-700 active:text-amber-700 dark:text-amber-400 dark:hover:text-amber-400 dark:active:text-amber-400',
    Icon: CircleDot
  },
  ready_to_review: {
    label: 'Ready to review',
    iconClassName: 'text-emerald-500',
    badgeClassName: 'bg-emerald-500/15',
    headerClassName:
      'text-emerald-700 hover:text-emerald-700 active:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-400 dark:active:text-emerald-400',
    Icon: Eye
  },
  done: {
    label: 'Done',
    iconClassName: 'text-sidebar-foreground/70',
    badgeClassName: 'bg-sidebar-foreground/10',
    headerClassName:
      'text-sidebar-foreground/80 hover:text-sidebar-foreground/80 active:text-sidebar-foreground/80',
    Icon: CircleCheck
  }
}

export function workspaceStatus(status: unknown): WorkspaceStatus {
  return isWorkspaceStatus(status) ? status : 'todo'
}

/** Status lives on each workspace row. A leftover multi-root root keeps it for the group. */
export function workspaceCarriesStatus(project: Project, workspace: Workspace): boolean {
  const multiRoot = project.kind === 'multi-root' || project.repositories.length > 1
  return !multiRoot || workspace.kind === 'root'
}

/** A folder that is not a git checkout. The sidebar shows it as one workspace row. */
export function isPlainDirectoryProject(
  project: Pick<Project, 'kind' | 'github' | 'repositories' | 'workspaces'>
): boolean {
  if (project.kind !== 'directory' || project.github) return false
  if (project.repositories.length !== 1 || project.workspaces.length !== 1) return false
  const repository = project.repositories[0]
  const workspace = project.workspaces[0]
  if (!repository || !workspace || workspace.kind === 'root') return false
  return repository.defaultBranch.trim() === '' && workspace.branch.trim() === ''
}
