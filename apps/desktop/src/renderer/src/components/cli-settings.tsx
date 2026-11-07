import { useEffect, useRef, useState } from 'react'
import type { CliInstallStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { SettingsGroup, SettingsRow } from '@/components/settings-layout'
import { SuccessToast } from '@/components/success-toast'
import { useClipboard } from '@/hooks/use-clipboard'

export function CliSettings(): React.JSX.Element {
  const copy = useClipboard()
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
    <section className="space-y-8" data-testid="settings-cli" aria-busy={busy}>
      {status ? (
        <>
          <SettingsGroup title="Command-line tool">
            <SettingsRow
              label="Status"
              description="Manage projects and workspaces from your terminal. No separate Node.js installation needed."
            >
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span data-testid="cli-status" className="text-[13px] font-medium">
                  {status.state === 'installed'
                    ? 'Installed'
                    : status.state === 'repair'
                      ? 'Repair needed'
                      : status.state === 'conflict'
                        ? 'Installation conflict'
                        : status.state === 'unsupported'
                          ? 'Unavailable'
                          : 'Not installed'}
                </span>
                <div className="flex flex-wrap justify-end gap-2">
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
              </div>
            </SettingsRow>
            <SettingsRow
              label="Version"
              description={
                status.development ? (
                  <>
                    Development mode installs <code>cerebro-dev</code> from this checkout, leaving
                    your released <code>cerebro</code> command alone. Rebuilds update the CLI
                    automatically. It defaults to this app’s data directory; CEREBRO_HOME can
                    override it.
                  </>
                ) : (
                  'Updates with Cerebro.'
                )
              }
            >
              <span className="shrink-0 text-xs">{status.version}</span>
            </SettingsRow>
            <SettingsRow label="Command location" stacked>
              <span className="break-all font-mono text-xs text-muted-foreground">
                {status.path}
              </span>
            </SettingsRow>
            <SettingsRow label="Shell configuration" description={status.message} stacked>
              <span className="break-all text-xs text-muted-foreground">
                {status.onPath ? (
                  'Command directory is already on PATH.'
                ) : (
                  <code>{status.profile}</code>
                )}
              </span>
            </SettingsRow>
          </SettingsGroup>
          <SettingsGroup title="Usage">
            <SettingsRow
              label={<code className="text-xs">{status.command} --help</code>}
              description="Install updates shell configuration only when the command directory is missing from PATH. Remove deletes the launcher and any PATH entry Cerebro added; your projects and data stay on disk. If you move the app, repair the installation."
            >
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setToast(null)
                  void copy(`${status.command} --help`).then((success) => {
                    if (success) {
                      setError(null)
                      notify('Command copied to clipboard.')
                    } else setError('Could not copy command.')
                  })
                }}
              >
                Copy command
              </Button>
            </SettingsRow>
          </SettingsGroup>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Loading CLI status…</p>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <SuccessToast toast={toast} onDismiss={() => setToast(null)} testId="cli-success-toast" />
    </section>
  )
}
