import { useRef, useState } from 'react'
import type { DiagnosticsExportResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { SettingsGroup, SettingsRow } from '@/components/settings-layout'
import { SuccessToast } from '@/components/success-toast'

type Saved = Extract<DiagnosticsExportResult, { state: 'saved' }>

const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`

export function DiagnosticsSettings(): React.JSX.Element {
  const [saved, setSaved] = useState<Saved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const toastId = useRef(0)

  const exportBundle = async (): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    setToast(null)
    try {
      const result = await window.cerebro.exportDiagnostics()
      if (result.state === 'saved') {
        setSaved(result)
        setToast({ id: ++toastId.current, message: 'Diagnostics exported.' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <section className="space-y-8" data-testid="settings-diagnostics" aria-busy={busy}>
      <SettingsGroup title="Export diagnostics">
        <SettingsRow
          label="Diagnostics bundle"
          description="Save a zip you can send when something goes wrong, such as the terminal server failing to connect. It is created only when you export it and is never uploaded."
        >
          <Button size="sm" onClick={() => void exportBundle()} data-testid="diagnostics-export">
            {busy ? 'Exporting…' : 'Export diagnostics…'}
          </Button>
        </SettingsRow>
        {saved ? (
          <div className="space-y-1 px-4 py-3 text-xs">
            <p data-testid="diagnostics-result">
              Saved {formatBytes(saved.bytes)}
              {saved.muxRunning ? '' : ' (terminal server was not running)'}.
            </p>
            <p className="break-all font-mono text-muted-foreground">{saved.path}</p>
          </div>
        ) : null}
      </SettingsGroup>
      <SettingsGroup title="What the bundle contains">
        <SettingsRow
          label="Included"
          description="Recent event logs from the app, terminal server and CLI; app, system and server versions; and counts of projects, workspaces, tabs and panes."
          stacked
        />
        <SettingsRow
          label="Never included"
          description={
            <>
              Terminal output or input, chat sessions, project, workspace or branch names, file
              contents, and credentials. Your home folder appears as <code>~</code>. The files are
              plain text, so you can review them before sharing.
            </>
          }
          stacked
        />
      </SettingsGroup>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <SuccessToast
        toast={toast}
        onDismiss={() => setToast(null)}
        testId="diagnostics-success-toast"
      />
    </section>
  )
}
