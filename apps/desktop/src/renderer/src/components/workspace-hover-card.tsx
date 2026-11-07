import { useRef, useState, type ReactElement, type ReactNode } from 'react'
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import { PreviewCard } from '@base-ui/react/preview-card'
import type { NestedRepo, Workspace, WorkspacePrStatus, WorkspacePullRequest } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { CiChecks, CiStatus } from './ci-status'
import { WorkspaceStatusIcon } from './workspace-status'
import { WORKSPACE_STATUS_PRESENTATION, workspaceStatus } from '@/lib/workspace-status'

function prStatePresentation(pr: WorkspacePullRequest): {
  label: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  Icon: typeof GitPullRequest
  className: string
} {
  if (pr.state === 'merged') {
    return {
      label: 'Merged',
      state: 'merged',
      Icon: GitMerge,
      className: 'border-transparent bg-violet-600 text-white dark:bg-violet-500'
    }
  }
  if (pr.state === 'closed') {
    return {
      label: 'Closed',
      state: 'closed',
      Icon: GitPullRequestClosed,
      className: 'border-transparent bg-red-600 text-white dark:bg-red-500'
    }
  }
  if (pr.isDraft) {
    return {
      label: 'Draft',
      state: 'draft',
      Icon: GitPullRequestDraft,
      className: 'border-transparent bg-zinc-500 text-white'
    }
  }
  return {
    label: 'Open',
    state: 'open',
    Icon: GitPullRequest,
    className: 'border-transparent bg-emerald-600 text-white dark:bg-emerald-500'
  }
}

function reviewLabel(pr: WorkspacePullRequest): string {
  return (
    {
      approved: 'Approved',
      changes_requested: 'Changes requested',
      review_required: 'Review required',
      none: 'No review decision'
    }[pr.reviewDecision] ?? 'No review decision'
  )
}

function PrStateBadge({
  pr,
  identifier
}: {
  pr: WorkspacePullRequest
  identifier: number | string
}): React.JSX.Element {
  const { label, state, Icon, className } = prStatePresentation(pr)
  return (
    <Badge
      data-testid={`workspace-pr-status-${identifier}`}
      data-pr-state={state}
      aria-label={`${label} pull request`}
      className={cn('font-semibold', className)}
    >
      <Icon aria-hidden />
      {label}
    </Badge>
  )
}

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

function relativeCreatedAt(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000)
  if (!Number.isFinite(seconds)) return 'Unknown'
  if (seconds < 60) return 'just now'
  const units = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute']
  ] as const
  const [size, unit] = units.find(([size]) => seconds >= size)!
  return RELATIVE_TIME_FORMAT.format(-Math.floor(seconds / size), unit)
}

/** Shared hover preview for workspace rows and nested repository rows. */
function HoverCardPreview({
  label,
  testId,
  trigger,
  children
}: {
  label: string
  testId: string
  trigger: ReactElement
  children: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const dismissed = useRef(false)
  const focusFromPopupTrigger = useRef(false)
  return (
    <PreviewCard.Root
      open={open}
      onOpenChange={(next, eventDetails) => {
        // Menus and the click-open PR popover take priority over hover details.
        if (
          next &&
          (dismissed.current ||
            (eventDetails.reason === 'trigger-focus' && focusFromPopupTrigger.current) ||
            triggerRef.current?.querySelector('[aria-expanded="true"][aria-haspopup]') ||
            document.querySelector(
              '[data-slot="dialog-content"][data-open], [data-slot="dropdown-menu-content"][data-open], [data-slot="dropdown-menu-sub-content"][data-open], [data-slot="popover-content"][data-open]'
            ))
        ) {
          eventDetails.cancel()
          return
        }
        setOpen(next)
      }}
    >
      <PreviewCard.Trigger
        delay={350}
        closeDelay={150}
        render={trigger}
        ref={(node) => {
          triggerRef.current = node
        }}
        onPointerEnter={() => {
          dismissed.current = false
        }}
        onPointerDownCapture={() => {
          dismissed.current = true
          setOpen(false)
        }}
        onKeyDownCapture={() => {
          dismissed.current = true
          setOpen(false)
        }}
        onFocusCapture={(event) => {
          // Menu/popover buttons get focus back on close. That focus bubbles
          // through the row and must not schedule a new hover card.
          if (event.target instanceof Element && event.target.closest('[aria-haspopup]')) {
            focusFromPopupTrigger.current = true
          } else {
            focusFromPopupTrigger.current = false
            dismissed.current = false
          }
        }}
      />
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="isolate z-50"
        >
          <PreviewCard.Popup
            role="dialog"
            aria-label={label}
            data-testid={testId}
            className="app-no-drag z-50 grid w-96 max-w-[calc(100vw-24px)] grid-cols-1 gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            {children}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}

function PullRequestDetails({
  pr,
  prStatus,
  identifier
}: {
  pr: WorkspacePullRequest
  prStatus?: WorkspacePrStatus
  identifier: number | string
}): React.JSX.Element {
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-start justify-between gap-2">
        <a
          href={pr.url}
          className="min-w-0 flex-1 break-words font-medium text-primary underline underline-offset-4"
          onClick={(event) => {
            event.preventDefault()
            void window.cerebro.openExternal(pr.url)
          }}
        >
          #{pr.number} · {pr.title}
        </a>
        <PrStateBadge pr={pr} identifier={identifier} />
      </div>
      <p className="text-xs text-muted-foreground">PR created {relativeCreatedAt(pr.createdAt)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Review</dt>
        <dd>{reviewLabel(pr)}</dd>
        <dt className="text-muted-foreground">Mergeable</dt>
        <dd>{pr.mergeable === null ? 'Unknown' : pr.mergeable ? 'Yes' : 'Conflicts'}</dd>
        <dt className="text-muted-foreground">CI</dt>
        <dd>
          <CiStatus state={pr.ciStatus ?? 'unavailable'} />
        </dd>
      </dl>
      <CiChecks pr={pr} />
      {prStatus?.state === 'stale' ? (
        <p className="text-xs text-amber-500">Last known status · Refresh failed</p>
      ) : null}
    </div>
  )
}

export function WorkspaceHoverCard({
  workspace,
  label,
  showStatus = true,
  multiRoot = false,
  children
}: {
  workspace?: Workspace
  /** Sidebar row name, including a custom rename. */
  label: string
  showStatus?: boolean
  /** A directory workspace that contains multiple git checkouts. */
  multiRoot?: boolean
  children: ReactElement
}): React.JSX.Element {
  if (!workspace) return children
  const pr = workspace.pullRequest
  const fallbackLabel = multiRoot
    ? 'Multi-root workspace'
    : workspace.kind === 'root'
      ? 'Root workspace'
      : 'Folder workspace'
  const name = label.trim() || fallbackLabel
  const branch = workspace.branch && workspace.branch !== '.' ? workspace.branch : null
  return (
    <HoverCardPreview
      label="Workspace details"
      testId={`workspace-hover-${workspace.id}`}
      trigger={children}
    >
      <div className="space-y-1">
        <p
          className="min-w-0 break-words font-medium"
          data-testid={`workspace-hover-name-${workspace.id}`}
        >
          {name}
        </p>
        {branch && branch !== name ? (
          <p className="min-w-0 break-words text-xs text-muted-foreground">{branch}</p>
        ) : null}
        {showStatus ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <WorkspaceStatusIcon status={workspaceStatus(workspace.status)} />
            {WORKSPACE_STATUS_PRESENTATION[workspaceStatus(workspace.status)].label}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Workspace created {relativeCreatedAt(workspace.createdAt)}
        </p>
      </div>
      {pr ? (
        <PullRequestDetails pr={pr} prStatus={workspace.prStatus} identifier={workspace.id} />
      ) : null}
    </HoverCardPreview>
  )
}

export function NestedRepoHoverCard({
  repo,
  children
}: {
  repo: NestedRepo
  children: ReactElement
}): React.JSX.Element {
  return (
    <HoverCardPreview
      label="Repository details"
      testId={`workspace-nested-hover-${repo.name}`}
      trigger={children}
    >
      <div className="space-y-1">
        <p className="break-words font-medium">{repo.branch || repo.name}</p>
        {repo.branch ? (
          <p className="truncate text-xs text-muted-foreground" title={repo.localPath}>
            {repo.name}
          </p>
        ) : null}
      </div>
      {repo.pullRequest ? (
        <PullRequestDetails
          pr={repo.pullRequest}
          prStatus={repo.prStatus}
          identifier={`nested-${repo.name}`}
        />
      ) : null}
    </HoverCardPreview>
  )
}
