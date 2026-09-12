import {
  Check,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquareWarning,
  RefreshCw
} from 'lucide-react'
import type { Workspace, WorkspacePullRequest } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { queryClient } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { CiChecks, CiStatus } from './ci-status'

function presentation(pr: WorkspacePullRequest): {
  label: string
  state: string
  Icon: typeof GitPullRequest
  color: string
} {
  if (pr.state === 'merged')
    return { label: 'Merged', state: 'merged', Icon: GitMerge, color: 'text-violet-500' }
  if (pr.state === 'closed')
    return { label: 'Closed', state: 'closed', Icon: GitPullRequestClosed, color: 'text-red-500' }
  if (pr.isDraft)
    return {
      label: 'Draft',
      state: 'draft',
      Icon: GitPullRequestDraft,
      color: 'text-muted-foreground'
    }
  if (pr.reviewDecision === 'changes_requested')
    return {
      label: 'Changes requested',
      state: 'changes_requested',
      Icon: MessageSquareWarning,
      color: 'text-amber-500'
    }
  if (pr.reviewDecision === 'approved')
    return { label: 'Approved', state: 'approved', Icon: Check, color: 'text-emerald-500' }
  return { label: 'Open', state: 'open', Icon: GitPullRequest, color: 'text-emerald-500' }
}
function reviewLabel(pr: WorkspacePullRequest): string {
  return {
    approved: 'Approved',
    changes_requested: 'Changes requested',
    review_required: 'Review required',
    none: 'No review decision'
  }[pr.reviewDecision]
}
const providerLabels = { 'github-app': 'GitHub App', gh: 'GitHub CLI', git: 'Git' }

export function WorkspacePrPopover({
  workspace,
  className
}: {
  workspace: Workspace
  className?: string
}): React.JSX.Element {
  const pr = workspace.pullRequest
  const status = workspace.prStatus
  // Initial loading, missing PRs and unavailable providers all keep the normal row icon.
  if (!pr)
    return (
      <span
        aria-hidden
        data-testid={`workspace-default-icon-${workspace.id}`}
        className={cn('pointer-events-none text-sidebar-foreground/70', className)}
      >
        <GitBranch className="size-full" />
      </span>
    )
  const display = presentation(pr)
  const { Icon } = display
  const stale = status?.state === 'stale'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`workspace-pr-icon-${workspace.id}`}
          data-pr-state={display.state}
          data-stale={stale}
          aria-label={`${display.label} pull request #${pr.number}${stale ? ' (stale)' : ''}`}
          title={`${display.label}${stale ? ' · Refresh failed' : ''}`}
          className={cn(
            'app-no-drag inline-flex shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            display.color,
            className
          )}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Icon className="size-full" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="app-no-drag max-h-[85vh] w-96 overflow-y-auto"
        data-testid={`workspace-pr-popover-${workspace.id}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid grid-cols-1 gap-3 text-sm">
          <div className="space-y-1">
            <p className="font-medium">{workspace.branch}</p>
            <p className="truncate text-xs text-muted-foreground" title={workspace.localPath}>
              {workspace.localPath}
            </p>
          </div>
          <div className="space-y-1 border-t pt-3">
            <p className="font-medium" data-testid={`workspace-pr-title-${workspace.id}`}>
              {pr.title}
            </p>
            <p className="text-xs text-muted-foreground">
              #{pr.number} · {pr.repoFullName}
            </p>
            <p className="text-xs text-muted-foreground">
              Created {new Date(pr.createdAt).toLocaleString()}
            </p>
            <p className="text-xs">State: {display.label}</p>
            <p className="text-xs">Review: {reviewLabel(pr)}</p>
            <p className="text-xs">
              Mergeable: {pr.mergeable === null ? 'Unknown' : pr.mergeable ? 'Yes' : 'Conflict'}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            CI <CiStatus state={pr.ciStatus ?? 'unavailable'} />
          </div>
          <CiChecks pr={pr} />
          {status?.provider ? (
            <p className="text-xs text-muted-foreground">
              Source: {providerLabels[status.provider]}
            </p>
          ) : null}
          {status?.checkedAt ? (
            <p className="text-xs text-muted-foreground">
              Last checked {new Date(status.checkedAt).toLocaleTimeString()}
              {stale ? ' · Stale' : ''}
            </p>
          ) : null}
          {status?.message ? (
            <p className="whitespace-pre-line text-xs text-muted-foreground">{status.message}</p>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['repository'] })
            }}
          >
            <RefreshCw />
            Refresh PR status
          </Button>
          <Button
            size="sm"
            className="w-full"
            data-testid={`workspace-pr-open-${workspace.id}`}
            onClick={() => {
              void window.cerebro.openExternal(pr.url)
            }}
          >
            Open pull request
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
