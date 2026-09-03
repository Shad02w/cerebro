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
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="clone-location">Default clone location</Label>
        <div className="flex gap-2">
          <Input
            id="clone-location"
            value={loading ? 'Loading…' : cloneLocation}
            disabled={loading || saving}
            className="font-mono text-sm"
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
            disabled={loading || saving}
            onClick={(): void => {
              void handleChooseFolder()
            }}
          >
            Choose folder
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        New workspaces are cloned into this folder. Existing checkouts are not moved.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

export function SettingsView({ section }: SettingsViewProps): React.JSX.Element {
  const meta = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]
  const Icon = meta.icon

  return (
    <div className="app-drag-region relative flex min-h-0 flex-1 flex-col">
      <div className="app-no-drag flex-1 overflow-auto p-6">
        <div className="flex max-w-2xl flex-col gap-6">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Icon className="size-6" />
              {meta.label}
            </h1>
            <p className="text-sm text-muted-foreground">{meta.description}</p>
          </div>
          {section === 'general' ? (
            <GeneralSettings />
          ) : (
            <p className="text-sm text-muted-foreground">This section is not available yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
