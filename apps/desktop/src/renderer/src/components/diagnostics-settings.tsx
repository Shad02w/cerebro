import { useRef, useState } from 'react'
import type { DiagnosticsExportResult } from '@shared/types'
import { Button } from '@/components/ui/button'
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
    <section className="space-y-4" data-testid="settings-diagnostics" aria-busy={busy}>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Export diagnostics</h2>
        <p className="text-xs text-muted-foreground">
          Save a zip you can send when something goes wrong, such as the terminal server failing to
          connect. It is created only when you export it and is never uploaded. To send one
          conversation and images, use Report on that conversation.
        </p>
      </div>
      <dl className="space-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Included</dt>
          <dd className="mt-1">
            Recent event logs from the app, terminal server and CLI; app, system and server
            versions; and counts of projects, workspaces, tabs and panes.
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Never included</dt>
          <dd className="mt-1">
            Terminal output or input, chat sessions, project, workspace or branch names, file
            contents, and credentials. Your home folder appears as <code>~</code>. The files are
            plain text, so you can review them before sharing.
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void exportBundle()} data-testid="diagnostics-export">
          {busy ? 'Exporting…' : 'Export diagnostics…'}
        </Button>
      </div>
      {saved ? (
        <div className="space-y-1 rounded-md border border-border p-3 text-xs">
          <p data-testid="diagnostics-result">
            Saved {formatBytes(saved.bytes)}
            {saved.muxRunning ? '' : ' (terminal server was not running)'}.
          </p>
          <p className="break-all font-mono text-muted-foreground">{saved.path}</p>
        </div>
      ) : null}
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
