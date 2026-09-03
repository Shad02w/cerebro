import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Workspace, WorkspaceListResult } from '@shared/types'

type WorkspacesState = {
  workspaces: Workspace[]
  activeWorkspaceId: number | null
  activeWorkspace: Workspace | null
  loading: boolean
  error: string | null
  refresh: () => Promise<WorkspaceListResult>
  createWorkspace: (gitUrl: string) => Promise<Workspace>
  selectWorkspace: (workspaceId: number) => Promise<void>
}

function applyResult(
  result: WorkspaceListResult,
  setWorkspaces: (workspaces: Workspace[]) => void,
  setActiveWorkspaceId: (id: number | null) => void
): void {
  setWorkspaces(result.workspaces)
  setActiveWorkspaceId(result.activeWorkspaceId)
}

export function useWorkspaces(): WorkspacesState {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<WorkspaceListResult> => {
    const result = await window.cerebro.listWorkspaces()
    applyResult(result, setWorkspaces, setActiveWorkspaceId)
    return result
  }, [])

  useEffect(() => {
    let cancelled = false
    void refresh()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workspaces.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const createWorkspace = useCallback(
    async (gitUrl: string): Promise<Workspace> => {
      setError(null)
      const workspace = await window.cerebro.createWorkspace(gitUrl)
      await refresh()
      return workspace
    },
    [refresh]
  )

  const selectWorkspace = useCallback(async (workspaceId: number): Promise<void> => {
    const result = await window.cerebro.setActiveWorkspace(workspaceId)
    applyResult(result, setWorkspaces, setActiveWorkspaceId)
  }, [])

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId]
  )

  return {
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    loading,
    error,
    refresh,
    createWorkspace,
    selectWorkspace
  }
}
