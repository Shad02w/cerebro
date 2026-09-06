import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project, ProjectBranch, ProjectListResult, Workspace } from '@shared/types'

type ProjectsState = {
  projects: Project[]
  activeWorkspaceId: number | null
  activeWorkspace: Workspace | null
  activeProject: Project | null
  loading: boolean
  error: string | null
  refresh: () => Promise<ProjectListResult>
  createProject: (gitUrl: string) => Promise<Project>
  createProjectFromDirectory: (directory: string) => Promise<Project>
  selectWorkspace: (workspaceId: number) => Promise<void>
  createWorkspace: (projectId: number, branch: string, from?: string | null) => Promise<Workspace>
  removeWorkspace: (workspaceId: number, deleteFiles: boolean) => Promise<void>
  removeProject: (projectId: number, deleteFiles: boolean) => Promise<void>
  listProjectBranches: (projectId: number) => Promise<ProjectBranch[]>
}

function applyResult(
  result: ProjectListResult,
  setProjects: (projects: Project[]) => void,
  setActiveWorkspaceId: (id: number | null) => void
): void {
  setProjects(result.projects)
  setActiveWorkspaceId(result.activeWorkspaceId)
}

export function useProjects(): ProjectsState {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<ProjectListResult> => {
    const result = await window.cerebro.listProjects()
    applyResult(result, setProjects, setActiveWorkspaceId)
    return result
  }, [])

  useEffect(() => {
    let cancelled = false
    void refresh()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load projects.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  // Re-fetch when the CLI (or any external process) mutates the database.
  useEffect(() => {
    return window.cerebro.onProjectsInvalidate(() => {
      void refresh().catch(() => {
        // Swallow errors on background refresh; stale UI is better than a crash.
      })
    })
  }, [refresh])

  const createProject = useCallback(
    async (gitUrl: string): Promise<Project> => {
      setError(null)
      const project = await window.cerebro.createProject(gitUrl)
      await refresh()
      return project
    },
    [refresh]
  )

  const createProjectFromDirectory = useCallback(
    async (directory: string): Promise<Project> => {
      setError(null)
      const project = await window.cerebro.createProjectFromDirectory(directory)
      await refresh()
      return project
    },
    [refresh]
  )

  const selectWorkspace = useCallback(async (workspaceId: number): Promise<void> => {
    const result = await window.cerebro.setActiveWorkspace(workspaceId)
    applyResult(result, setProjects, setActiveWorkspaceId)
  }, [])

  const createWorkspace = useCallback(
    async (projectId: number, branch: string, from?: string | null): Promise<Workspace> => {
      setError(null)
      const workspace = await window.cerebro.createWorkspace(projectId, branch, from)
      await refresh()
      return workspace
    },
    [refresh]
  )

  const removeWorkspace = useCallback(
    async (workspaceId: number, deleteFiles: boolean): Promise<void> => {
      setError(null)
      const result = await window.cerebro.removeWorkspace(workspaceId, deleteFiles)
      applyResult(result, setProjects, setActiveWorkspaceId)
    },
    []
  )

  const removeProject = useCallback(
    async (projectId: number, deleteFiles: boolean): Promise<void> => {
      setError(null)
      const result = await window.cerebro.removeProject(projectId, deleteFiles)
      applyResult(result, setProjects, setActiveWorkspaceId)
    },
    []
  )

  const listProjectBranches = useCallback(async (projectId: number): Promise<ProjectBranch[]> => {
    return window.cerebro.listProjectBranches(projectId)
  }, [])

  const activeWorkspace = useMemo(() => {
    for (const project of projects) {
      const workspace = project.workspaces.find((item) => item.id === activeWorkspaceId)
      if (workspace) return workspace
    }
    return null
  }, [projects, activeWorkspaceId])

  const activeProject = useMemo(() => {
    if (!activeWorkspace) return null
    return projects.find((project) => project.id === activeWorkspace.projectId) ?? null
  }, [projects, activeWorkspace])

  return {
    projects,
    activeWorkspaceId,
    activeWorkspace,
    activeProject,
    loading,
    error,
    refresh,
    createProject,
    createProjectFromDirectory,
    selectWorkspace,
    createWorkspace,
    removeWorkspace,
    removeProject,
    listProjectBranches
  }
}
