import {
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  CircleMinus,
  Clock3,
  Hourglass,
  PauseCircle,
  ShieldAlert,
  TimerOff,
  TriangleAlert,
  XCircle
} from 'lucide-react'
import type { WorkspaceCiCheck, WorkspacePullRequest } from '@shared/types'

const presentation = {
  success: { label: 'Passing', Icon: CheckCircle2, color: 'text-success' },
  failure: { label: 'Failing', Icon: XCircle, color: 'text-destructive' },
  in_progress: { label: 'Running', Icon: CircleDashed, color: 'text-info' },
  queued: { label: 'Queued', Icon: Hourglass, color: 'text-warning' },
  pending: { label: 'Pending', Icon: Clock3, color: 'text-warning' },
  waiting: { label: 'Waiting', Icon: PauseCircle, color: 'text-warning' },
  cancelled: { label: 'Cancelled', Icon: Ban, color: 'text-muted-foreground' },
  skipped: { label: 'Skipped', Icon: CircleMinus, color: 'text-muted-foreground' },
  neutral: { label: 'Neutral', Icon: CircleMinus, color: 'text-muted-foreground' },
  timed_out: { label: 'Timed out', Icon: TimerOff, color: 'text-destructive' },
  action_required: { label: 'Action required', Icon: ShieldAlert, color: 'text-warning' },
  startup_failure: { label: 'Startup failed', Icon: TriangleAlert, color: 'text-destructive' },
  stale: { label: 'Stale', Icon: Clock3, color: 'text-muted-foreground' },
  none: { label: 'No checks', Icon: CircleMinus, color: 'text-muted-foreground' },
  unavailable: { label: 'Unavailable', Icon: CircleHelp, color: 'text-muted-foreground' }
}

export function CiStatus({
  state
}: {
  state: WorkspaceCiCheck['state'] | NonNullable<WorkspacePullRequest['ciStatus']>
}): React.JSX.Element {
  const { label, Icon, color } = presentation[state]
  return (
    <span
      data-ci-state={state}
      className={`inline-flex shrink-0 items-center gap-1.5 font-medium ${color}`}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {label}
    </span>
  )
}

export function CiChecks({ pr }: { pr: WorkspacePullRequest }): React.JSX.Element | null {
  const checks = pr.ciChecks ?? []
  const total = pr.ciCheckCount ?? checks.length
  if (!checks.length) return null
  return (
    <section aria-label="CI checks" className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Checks</span>
        <span className="text-muted-foreground">{total} total</span>
      </div>
      <ul className="max-h-48 space-y-2 overflow-y-auto pr-1 text-xs">
        {checks.map((check, index) => (
          <li key={`${check.name}-${index}`} className="space-y-0.5">
            <div className="flex items-start justify-between gap-3">
              {check.url ? (
                <a
                  href={check.url}
                  className="min-w-0 break-words underline underline-offset-4 hover:text-primary"
                  onClick={(event) => {
                    event.preventDefault()
                    void window.cerebro.openExternal(check.url!)
                  }}
                >
                  {check.name}
                </a>
              ) : (
                <span className="min-w-0 break-words">{check.name}</span>
              )}
              <CiStatus state={check.state} />
            </div>
            {check.description ? (
              <p className="break-words text-muted-foreground">{check.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {total > checks.length ? (
        <p className="text-xs text-muted-foreground">
          Showing {checks.length} of {total} checks.
        </p>
      ) : null}
      <a
        href={`${pr.url}/checks`}
        className="block text-xs underline underline-offset-4"
        onClick={(event) => {
          event.preventDefault()
          void window.cerebro.openExternal(`${pr.url}/checks`)
        }}
      >
        View all checks on GitHub
      </a>
    </section>
  )
}
