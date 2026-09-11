import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, AppSettingsPatch } from '@shared/types'

type SettingsState = {
  settings: AppSettings | null
  loading: boolean
  error: string | null
  refresh: () => Promise<AppSettings>
  update: (patch: AppSettingsPatch) => Promise<AppSettings>
  pickDirectory: () => Promise<string | null>
}

export function useSettings(): SettingsState {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<AppSettings> => {
    const next = await window.cerebro.getSettings()
    setSettings(next)
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.cerebro
      .getSettings()
      .then((next) => {
        if (!cancelled) setSettings(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load settings.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const update = useCallback(async (patch: AppSettingsPatch): Promise<AppSettings> => {
    setError(null)
    const next = await window.cerebro.setSettings(patch)
    setSettings(next)
    return next
  }, [])

  const pickDirectory = useCallback(async (): Promise<string | null> => {
    return window.cerebro.pickDirectory()
  }, [])

  return {
    settings,
    loading,
    error,
    refresh,
    update,
    pickDirectory
  }
}
