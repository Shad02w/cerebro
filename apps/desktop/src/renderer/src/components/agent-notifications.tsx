import { useCallback, useEffect, useState } from 'react'
import { Bell, CircleAlert, CircleCheck, X } from 'lucide-react'
import type { AppNotification } from '@cerebro/core'

const AUTO_DISMISS_MS = 8000

function NotificationIcon({ kind }: { kind: AppNotification['kind'] }): React.JSX.Element {
  if (kind === 'blocked') return <Bell className="size-4 text-amber-500" aria-hidden="true" />
  if (kind === 'failed') return <CircleAlert className="size-4 text-red-500" aria-hidden="true" />
  return <CircleCheck className="size-4 text-green-500" aria-hidden="true" />
}

export function AgentNotifications(): React.JSX.Element | null {
  const [items, setItems] = useState<AppNotification[]>([])

  useEffect(
    () =>
      window.cerebro.onNotification((event) => {
        setItems((current) => {
          if (event.type === 'dismiss') return current.filter((n) => n.id !== event.id)
          return [...current.filter((n) => n.id !== event.notification.id), event.notification]
        })
      }),
    []
  )

  useEffect(() => {
    const timers = items.flatMap((n) =>
      n.kind === 'blocked'
        ? []
        : [setTimeout(() => setItems((current) => current.filter((c) => c !== n)), AUTO_DISMISS_MS)]
    )
    return () => timers.forEach(clearTimeout)
  }, [items])

  const remove = useCallback(
    (id: string) => setItems((current) => current.filter((n) => n.id !== id)),
    []
  )

  if (!items.length) return null
  return (
    <div
      className="app-no-drag fixed right-6 bottom-6 z-50 flex w-96 max-w-[calc(100vw-3rem)] flex-col gap-2"
      role="region"
      aria-label="Agent notifications"
    >
      {items.map((n) => (
        <div
          key={n.id}
          role={n.kind === 'blocked' ? 'alertdialog' : 'status'}
          aria-label={n.title}
          data-testid="agent-notification"
          data-kind={n.kind}
          className="flex flex-col gap-2 rounded-lg border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5">
              <NotificationIcon kind={n.kind} />
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                remove(n.id)
                void window.cerebro.respondToNotification({ type: 'open', notification: n })
              }}
            >
              <div className="truncate text-sm font-medium">{n.title}</div>
              <div className="line-clamp-3 text-sm text-muted-foreground">
                {n.command ? n.body.split('\n')[0] : n.body}
              </div>
            </button>
            <button
              type="button"
              aria-label="Dismiss notification"
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => remove(n.id)}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          {n.command ? (
            <pre
              data-testid="agent-notification-command"
              className="max-h-32 overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
            >
              <code>{n.command}</code>
            </pre>
          ) : null}
          {n.actions ? (
            <div className="flex justify-end gap-2">
              {n.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    remove(n.id)
                    void window.cerebro.respondToNotification({
                      type: 'action',
                      notification: n,
                      actionId: action.id
                    })
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
