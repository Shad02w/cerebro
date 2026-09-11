import { useEffect, useRef, useState } from 'react'
import type { CliInstallStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Toast } from 'radix-ui'
import { Check, X } from 'lucide-react'

export function CliSettings(): React.JSX.Element {
  const [status, setStatus] = useState<CliInstallStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const toastId = useRef(0)
  const notify = (message: string): void => {
    setToast({ id: ++toastId.current, message })
  }

  useEffect(() => {
    let active = true
    void window.cerebro
      .getCliStatus()
      .then((value) => {
        if (active) setStatus(value)
      })
      .catch((err: unknown) => {
        if (active) setError(String(err))
      })
    return () => {
      active = false
    }
  }, [])

  const run = async (
    action: () => Promise<CliInstallStatus>,
    successMessage?: string
  ): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    setToast(null)
    try {
      const next = await action()
      setStatus(next)
      if (successMessage && next.state === 'installed') notify(successMessage)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4" data-testid="settings-cli" aria-busy={busy}>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Command-line tool</h2>
        <p className="text-xs text-muted-foreground">
          Manage projects and workspaces from your terminal. No separate Node.js installation
          needed.
        </p>
      </div>
      {status ? (
        <>
          {status.development ? (
            <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              Development mode installs <code>cerebro-dev</code> from this checkout, leaving your
              released <code>cerebro</code> command alone. Rebuilds update the CLI automatically. It
              defaults to this app’s data directory; CEREBRO_HOME can override it.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Updates with Cerebro.</p>
          )}
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd data-testid="cli-status" className="mt-1 font-medium">
                {status.state === 'installed'
                  ? 'Installed'
                  : status.state === 'repair'
                    ? 'Repair needed'
                    : status.state === 'conflict'
                      ? 'Installation conflict'
                      : status.state === 'unsupported'
                        ? 'Unavailable'
                        : 'Not installed'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="mt-1">{status.version}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Command location</dt>
              <dd className="mt-1 break-all font-mono">{status.path}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Shell configuration</dt>
              <dd className="mt-1 break-all">
                {status.onPath ? (
                  'Command directory is already on PATH.'
                ) : (
                  <code>{status.profile}</code>
                )}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">{status.message}</p>
          <div className="flex flex-wrap gap-2">
            {status.state !== 'unsupported' && status.state !== 'conflict' ? (
              <>
                {status.state !== 'installed' ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      void run(
                        window.cerebro.installCli,
                        status.state === 'repair'
                          ? 'CLI installation repaired.'
                          : 'CLI installed successfully.'
                      )
                    }
                  >
                    {busy
                      ? 'Working…'
                      : status.state === 'repair'
                        ? 'Repair installation'
                        : 'Install CLI'}
                  </Button>
                ) : null}
                {status.state === 'installed' || status.state === 'repair' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void run(window.cerebro.removeCli)}
                  >
                    {busy ? 'Working…' : 'Remove CLI'}
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run(window.cerebro.getCliStatus)}
            >
              Refresh status
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Install updates shell configuration only when the command directory is missing from
            PATH. Remove deletes the launcher and any PATH entry Cerebro added; your projects and
            data stay on disk. If you move the app, repair the installation.
          </p>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <code className="text-xs">{status.command} --help</code>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setToast(null)
                void navigator.clipboard
                  .writeText(`${status.command} --help`)
                  .then(() => {
                    setError(null)
                    notify('Command copied to clipboard.')
                  })
                  .catch(() => setError('Could not copy command.'))
              }}
            >
              Copy command
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Loading CLI status…</p>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <Toast.Provider duration={4000} swipeDirection="right">
        {toast ? (
          <Toast.Root
            key={toast.id}
            defaultOpen
            onOpenChange={(open) => {
              if (!open) setToast(null)
            }}
            data-testid="cli-success-toast"
            className="app-no-drag flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
          >
            <Check className="size-4 shrink-0 text-green-500" aria-hidden="true" />
            <Toast.Title className="flex-1 text-sm">{toast.message}</Toast.Title>
            <Toast.Close
              aria-label="Dismiss notification"
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </Toast.Close>
          </Toast.Root>
        ) : null}
        <Toast.Viewport className="fixed right-6 bottom-6 z-50 m-0 flex w-96 max-w-[calc(100vw-3rem)] list-none flex-col gap-2 outline-none" />
      </Toast.Provider>
    </section>
  )
}
