import { CircleCheck, CircleDashed, CirclePlay, Eye } from 'lucide-react'
import { isWorkspaceStatus, type WorkspaceStatus } from '@shared/types'

export const WORKSPACE_STATUS_PRESENTATION: Record<
  WorkspaceStatus,
  { label: string; iconClassName: string; badgeClassName: string; Icon: typeof CircleDashed }
> = {
  todo: {
    label: 'Todo',
    iconClassName: 'text-zinc-600 dark:text-zinc-300',
    badgeClassName: 'bg-zinc-500/15',
    Icon: CircleDashed
  },
  in_progress: {
    label: 'In progress',
    iconClassName: 'text-sky-700 dark:text-sky-300',
    badgeClassName: 'bg-sky-500/15',
    Icon: CirclePlay
  },
  ready_to_review: {
    label: 'Ready to review',
    iconClassName: 'text-amber-700 dark:text-amber-300',
    badgeClassName: 'bg-amber-500/15',
    Icon: Eye
  },
  done: {
    label: 'Done',
    iconClassName: 'text-emerald-700 dark:text-emerald-300',
    badgeClassName: 'bg-emerald-500/15',
    Icon: CircleCheck
  }
}

export function workspaceStatus(status: unknown): WorkspaceStatus {
  return isWorkspaceStatus(status) ? status : 'todo'
}
