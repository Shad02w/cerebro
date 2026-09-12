import { useRef, useState, type ReactElement } from 'react'
import { HoverCard } from 'radix-ui'
import type { Workspace } from '@shared/types'
import { CiChecks, CiStatus } from './ci-status'

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
  return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(
    -Math.floor(seconds / size),
    unit
  )
}

export function WorkspaceHoverCard({
  workspace,
  children
}: {
  workspace?: Workspace
  children: ReactElement
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  if (!workspace) return children
  const pr = workspace.pullRequest
  const state =
    pr?.state === 'merged'
      ? 'Merged'
      : pr?.state === 'closed'
        ? 'Closed'
        : pr?.isDraft
          ? 'Draft'
          : 'Open'
  const review = pr
    ? {
        approved: 'Approved',
        changes_requested: 'Changes requested',
        review_required: 'Review required',
        none: 'No review decision'
      }[pr.reviewDecision]
    : null
  return (
    <HoverCard.Root
      open={open}
      onOpenChange={(next) => {
        // Menus and the click-open PR popover take priority over hover details.
        if (next && trigger.current?.querySelector('[aria-expanded="true"][aria-haspopup]')) return
        setOpen(next)
      }}
      openDelay={350}
      closeDelay={150}
    >
      <HoverCard.Trigger
        asChild
        ref={(node) => {
          trigger.current = node
        }}
        onPointerDownCapture={() => setOpen(false)}
        onKeyDownCapture={() => setOpen(false)}
      >
        {children}
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          role="dialog"
          aria-label="Workspace details"
          data-testid={`workspace-hover-${workspace.id}`}
          className="app-no-drag z-50 grid w-96 max-w-[calc(100vw-24px)] grid-cols-1 gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="space-y-1">
            <p className="break-words font-medium">
              {workspace.branch ||
                (workspace.kind === 'root' ? 'Root workspace' : 'Folder workspace')}
            </p>
            <p className="text-xs text-muted-foreground">
              Workspace created {relativeCreatedAt(workspace.createdAt)}
            </p>
          </div>
          {pr ? (
            <div className="space-y-2 border-t pt-3">
              <a
                href={pr.url}
                className="block break-words font-medium text-primary underline underline-offset-4"
                onClick={(event) => {
                  event.preventDefault()
                  void window.cerebro.openExternal(pr.url)
                }}
              >
                #{pr.number} · {pr.title}
              </a>
              <p className="text-xs text-muted-foreground">
                PR created {relativeCreatedAt(pr.createdAt)}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Status</dt>
                <dd>{state}</dd>
                <dt className="text-muted-foreground">Review</dt>
                <dd>{review}</dd>
                <dt className="text-muted-foreground">Mergeable</dt>
                <dd>{pr.mergeable === null ? 'Unknown' : pr.mergeable ? 'Yes' : 'Conflicts'}</dd>
                <dt className="text-muted-foreground">CI</dt>
                <dd>
                  <CiStatus state={pr.ciStatus ?? 'unavailable'} />
                </dd>
              </dl>
              <CiChecks pr={pr} />
              {workspace.prStatus?.state === 'stale' ? (
                <p className="text-xs text-amber-500">Last known status · Refresh failed</p>
              ) : null}
            </div>
          ) : null}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}
