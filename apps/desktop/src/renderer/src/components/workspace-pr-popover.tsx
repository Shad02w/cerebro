import type { Workspace, WorkspacePullRequest } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function reviewLabel(pr: WorkspacePullRequest): string {
  switch (pr.reviewDecision) {
    case 'approved':
      return 'Review passed'
    case 'changes_requested':
      return 'Changes requested'
    case 'review_required':
      return 'Review required'
    default:
      return 'No review decision'
  }
}

function stateLabel(pr: WorkspacePullRequest): string {
  switch (pr.state) {
    case 'merged':
      return 'Merged'
    case 'closed':
      return 'Closed'
    default:
      return 'Open'
  }
}

function badgeClasses(pr: WorkspacePullRequest): string {
  if (pr.state === 'merged') return 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
  if (pr.state === 'closed') return 'bg-muted text-muted-foreground'
  if (pr.reviewDecision === 'changes_requested') {
    return 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
  }
  if (pr.mergeable === false) return 'bg-destructive/15 text-destructive'
  return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
}

function badgeText(pr: WorkspacePullRequest): string {
  if (pr.state === 'merged') return 'Merged'
  if (pr.state === 'closed') return 'Closed'
  const parts: string[] = ['Open']
  if (pr.reviewDecision === 'changes_requested') parts.push('Changes requested')
  if (pr.mergeable === false) parts.push('Conflict')
  return parts.join(' · ')
}

type WorkspacePrPopoverProps = {
  workspace: Workspace
}

export function WorkspacePrPopover({
  workspace
}: WorkspacePrPopoverProps): React.JSX.Element | null {
  const pr = workspace.pullRequest
  if (!pr) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`workspace-pr-badge-${workspace.id}`}
          className={`app-no-drag max-w-[7.5rem] truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeClasses(pr)}`}
          onClick={(event): void => {
            event.stopPropagation()
          }}
          onPointerDown={(event): void => {
            event.stopPropagation()
          }}
        >
          {badgeText(pr)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="app-no-drag w-80"
        data-testid={`workspace-pr-popover-${workspace.id}`}
        onClick={(event): void => event.stopPropagation()}
      >
        <div className="grid gap-3 text-sm">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Workspace</p>
            <p className="font-medium">{workspace.branch}</p>
            <p className="truncate text-xs text-muted-foreground" title={workspace.localPath}>
              {workspace.localPath}
            </p>
          </div>
          <div className="space-y-1 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Pull request</p>
            <p className="font-medium" data-testid={`workspace-pr-title-${workspace.id}`}>
              {pr.title}
            </p>
            <p className="text-xs text-muted-foreground">
              #{pr.number} · {pr.repoFullName}
            </p>
            <p className="text-xs text-muted-foreground">
              Created {new Date(pr.createdAt).toLocaleString()}
            </p>
            <p className="text-xs">State: {stateLabel(pr)}</p>
            <p className="text-xs">Review: {reviewLabel(pr)}</p>
            <p className="text-xs">
              Mergeable: {pr.mergeable === null ? 'Unknown' : pr.mergeable ? 'Yes' : 'Conflict'}
            </p>
          </div>
          <Button
            size="sm"
            className="w-full"
            data-testid={`workspace-pr-open-${workspace.id}`}
            onClick={(): void => {
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
