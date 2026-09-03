import { useCallback, useEffect, useRef, useState } from 'react'
import { SETTINGS_SECTIONS } from '@/lib/settings-sections'
import type { SettingsSectionId } from '@/lib/app-route'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type SettingsViewProps = {
  section: SettingsSectionId
}

function GeneralSettings(): React.JSX.Element {
  const [cloneLocation, setCloneLocation] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedRef = useRef('')

  useEffect(() => {
    let cancelled = false
    void window.cerebro
      .getCloneLocation()
      .then((path) => {
        if (!cancelled) {
          savedRef.current = path
          setCloneLocation(path)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load clone location.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  const persist = useCallback(async (next: string): Promise<void> => {
    const trimmed = next.trim()
    if (!trimmed || trimmed === savedRef.current) return
    setSaving(true)
    setError(null)
    try {
      const saved = await window.cerebro.setCloneLocation(trimmed)
      savedRef.current = saved
      setCloneLocation(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update clone location.')
    } finally {
      setSaving(false)
    }
  }, [])

  const handleChooseFolder = useCallback(async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const next = await window.cerebro.chooseCloneLocation()
      if (next) {
        savedRef.current = next
        setCloneLocation(next)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update clone location.')
    } finally {
      setSaving(false)
    }
  }, [])

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium text-muted-foreground">Workspaces</h2>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="clone-location" className="text-[13px] font-medium">
            Default clone location
          </Label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            New workspaces are cloned into this folder. Existing checkouts are not moved.
          </p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="flex w-[min(24rem,48%)] shrink-0 items-center gap-2">
          <Input
            id="clone-location"
            value={loading ? 'Loading…' : cloneLocation}
            disabled={loading || saving}
            className="h-7 font-mono text-xs"
            onChange={(event): void => setCloneLocation(event.target.value)}
            onBlur={(event): void => {
              if (!loading) void persist(event.currentTarget.value)
            }}
            onKeyDown={(event): void => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={loading || saving}
            onClick={(): void => {
              void handleChooseFolder()
            }}
          >
            Choose folder
          </Button>
        </div>
      </div>
    </section>
  )
}

export function SettingsView({ section }: SettingsViewProps): React.JSX.Element {
  const meta = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]

  return (
    <div className="app-drag-region relative flex min-h-0 flex-1 flex-col">
      <div className="app-no-drag flex-1 overflow-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <h1 className="text-xl font-semibold tracking-tight">{meta.label}</h1>
          {section === 'general' ? (
            <GeneralSettings />
          ) : (
            <p className="text-xs text-muted-foreground">This section is not available yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
