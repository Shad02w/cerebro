import { useMutation, useQuery } from '@tanstack/react-query'
import { applyGitHubStatus, githubOptions } from '@/lib/query-client'
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
  const query = useQuery(githubOptions)
  const begin = useMutation({
    mutationFn: () => window.cerebro.beginGitHubDeviceFlow(),
    onSuccess: applyGitHubStatus
  })
  const cancel = useMutation({
    mutationFn: () => window.cerebro.cancelGitHubDeviceFlow(),
    onSuccess: applyGitHubStatus
  })
  const disconnect = useMutation({
    mutationFn: () => window.cerebro.disconnectGitHub(),
    onSuccess: applyGitHubStatus
  })
  return {
    status: query.data ?? null,
    loading: query.isPending,
    error:
      query.error?.message ??
      begin.error?.message ??
      cancel.error?.message ??
      disconnect.error?.message ??
      null,
    refresh: async (): Promise<GitHubStatus> => {
      const result = await query.refetch()
      if (!result.data) throw result.error
      return result.data
    },
    beginDeviceFlow: begin.mutateAsync,
    cancelDeviceFlow: cancel.mutateAsync,
    disconnect: disconnect.mutateAsync
  }
}
