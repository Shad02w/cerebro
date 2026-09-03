import { useCallback, useEffect, useState } from 'react'
import type { GitHubStatus } from '@shared/types'

type GitHubState = {
  status: GitHubStatus | null
  loading: boolean
  error: string | null
  refresh: () => Promise<GitHubStatus>
  beginDeviceFlow: () => Promise<GitHubStatus>
  cancelDeviceFlow: () => Promise<GitHubStatus>
  disconnect: () => Promise<GitHubStatus>
}

export function useGitHub(): GitHubState {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<GitHubStatus> => {
    const next = await window.cerebro.getGitHubStatus()
    setStatus(next)
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    void refresh()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load GitHub status.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const unsubscribe = window.cerebro.onGitHubStatus((next) => {
      setStatus(next)
      setError(null)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [refresh])

  const beginDeviceFlow = useCallback(async (): Promise<GitHubStatus> => {
    setError(null)
    const next = await window.cerebro.beginGitHubDeviceFlow()
    setStatus(next)
    return next
  }, [])

  const cancelDeviceFlow = useCallback(async (): Promise<GitHubStatus> => {
    setError(null)
    const next = await window.cerebro.cancelGitHubDeviceFlow()
    setStatus(next)
    return next
  }, [])

  const disconnect = useCallback(async (): Promise<GitHubStatus> => {
    setError(null)
    const next = await window.cerebro.disconnectGitHub()
    setStatus(next)
    return next
  }, [])

  return {
    status,
    loading,
    error,
    refresh,
    beginDeviceFlow,
    cancelDeviceFlow,
    disconnect
  }
}
