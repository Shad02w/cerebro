import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import type {
  Project,
  ProjectBranch,
  ProjectListResult,
  RepositoryPullRequests,
  Workspace,
  WorkspacePrStatus,
  WorkspaceStatus
} from '@shared/types'
import {
  applyActiveWorkspace,
  invalidateProjects,
  PR_REFRESH_MS,
  projectsOptions,
  pullRequestOptions,
  queryClient
} from '@/lib/query-client'

function repositoryKey(repo: { owner: string; repo: string }): string {
  return `${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`
}

function pullRequestStatus(
  query: { data?: RepositoryPullRequests; error: Error | null; isError: boolean } | undefined,
  repositoryQuery: { error: Error | null; isError: boolean }
): WorkspacePrStatus {
  const failed = query?.isError || repositoryQuery.isError
  return {
    state: failed ? (query?.data ? 'stale' : 'unavailable') : query?.data ? 'ready' : 'loading',
    provider: query?.data?.provider ?? null,
    checkedAt: query?.data?.checkedAt ?? null,
    message:
      query?.error?.message ??
      repositoryQuery.error?.message ??
      (query?.data?.issues.length
        ? query.data.issues.map((issue) => `${issue.provider}: ${issue.message}`).join('\n')
        : null)
  }
}

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
  renameWorkspace: (workspaceId: number, displayName: string | null) => Promise<void>
  removeWorkspace: (workspaceId: number, deleteFiles: boolean) => Promise<void>
  setWorkspaceStatus: (workspaceId: number, status: WorkspaceStatus) => Promise<void>
  removeProject: (projectId: number, deleteFiles: boolean) => Promise<void>
  listProjectBranches: (projectId: number) => Promise<ProjectBranch[]>
}

export function useProjects(): ProjectsState {
  const projectQuery = useQuery(projectsOptions)
  const repositoryQuery = useQuery({
    queryKey: ['workspace-repositories'],
    queryFn: () => window.cerebro.listWorkspaceRepositories(),
    enabled: !!projectQuery.data,
    refetchInterval: PR_REFRESH_MS,
    refetchIntervalInBackground: true
  })
  const projectData = projectQuery.data?.projects ?? []
  const nestedRepos = projectData.flatMap((project) => project.nestedRepos ?? [])
  const repositories = [
    ...new Map([
      ...(repositoryQuery.data ?? []).flatMap((workspace) =>
        workspace.github ? [[repositoryKey(workspace.github), workspace.github] as const] : []
      ),
      ...nestedRepos.flatMap((repo) =>
        repo.github ? [[repositoryKey(repo.github), repo.github] as const] : []
      )
    ]).values()
  ]
  // This hook lives at App level, independent of expanded sidebar rows.
  const pullRequests = useQueries({
    queries: repositories.map((repo) => pullRequestOptions(repo.owner, repo.repo))
  })
  const queriesByRepo = new Map(
    repositories.map((repo, index) => [
      `${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`,
      pullRequests[index]
    ])
  )
  const workspaceRepos = new Map(
    repositoryQuery.data?.map((workspace) => [workspace.workspaceId, workspace])
  )
  const projects: Project[] = projectData.map((project) => ({
    ...project,
    nestedRepos: project.nestedRepos?.map((repo) => {
      if (!repo.github) return { ...repo, pullRequest: null }
      const query = queriesByRepo.get(repositoryKey(repo.github))
      return {
        ...repo,
        pullRequest: query?.data?.byBranch[repo.branch] ?? null,
        prStatus: pullRequestStatus(query, repositoryQuery)
      }
    }),
    workspaces: project.workspaces.map((workspace): Workspace => {
      const identity = workspaceRepos.get(workspace.id)
      if (!identity?.github || !identity.branch) return { ...workspace, pullRequest: null }
      const query = queriesByRepo.get(repositoryKey(identity.github))
      return {
        ...workspace,
        branch: identity.branch,
        pullRequest: query?.data?.byBranch[identity.branch] ?? null,
        prStatus: pullRequestStatus(query, repositoryQuery)
      }
    })
  }))
  const activeWorkspaceId = projectQuery.data?.activeWorkspaceId ?? null
  const activeWorkspace =
    projects
      .flatMap((project) => project.workspaces)
      .find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const activeProject =
    projects.find((project) => project.id === activeWorkspace?.projectId) ?? null
  const updateList = async (result: ProjectListResult): Promise<void> => {
    await queryClient.cancelQueries({ queryKey: projectsOptions.queryKey })
    queryClient.setQueryData(projectsOptions.queryKey, result)
  }
  const createProject = useMutation({
    mutationFn: (gitUrl: string) => window.cerebro.createProject(gitUrl),
    onSuccess: invalidateProjects
  })
  const createDirectory = useMutation({
    mutationFn: (directory: string) => window.cerebro.createProjectFromDirectory(directory),
    onSuccess: invalidateProjects
  })
  // The row highlights and the content area switches on click; the mux write follows. A failed
  // write restores the previous selection.
  const selectWorkspace = useMutation({
    mutationFn: (id: number) => window.cerebro.setActiveWorkspace(id),
    onMutate: async (id: number) => {
      // An in-flight list fetched before this click would otherwise put the old row back.
      await queryClient.cancelQueries({ queryKey: projectsOptions.queryKey })
      const previous = queryClient.getQueryData(projectsOptions.queryKey)?.activeWorkspaceId ?? null
      applyActiveWorkspace(id)
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous != null) applyActiveWorkspace(context.previous)
      else void invalidateProjects()
    }
  })
  const createWorkspace = useMutation({
    mutationFn: ({
      projectId,
      branch,
      from
    }: {
      projectId: number
      branch: string
      from?: string | null
    }) => window.cerebro.createWorkspace(projectId, branch, from),
    onSuccess: invalidateProjects
  })
  const renameWorkspace = useMutation({
    mutationFn: ({ id, displayName }: { id: number; displayName: string | null }) =>
      window.cerebro.renameWorkspace(id, displayName),
    onSuccess: updateList
  })
  const removeWorkspace = useMutation({
    mutationFn: ({ id, deleteFiles }: { id: number; deleteFiles: boolean }) =>
      window.cerebro.removeWorkspace(id, deleteFiles),
    onSuccess: async (result) => {
      await updateList(result)
      await invalidateProjects()
    }
  })
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: WorkspaceStatus }) =>
      window.cerebro.setWorkspaceStatus(id, status),
    onSuccess: invalidateProjects
  })
  const removeProject = useMutation({
    mutationFn: ({ id, deleteFiles }: { id: number; deleteFiles: boolean }) =>
      window.cerebro.removeProject(id, deleteFiles),
    onSuccess: async (result) => {
      await updateList(result)
      await invalidateProjects()
    }
  })
  return {
    projects,
    activeWorkspaceId,
    activeWorkspace,
    activeProject,
    loading: projectQuery.isPending,
    error: projectQuery.error?.message ?? null,
    refresh: async (): Promise<ProjectListResult> => {
      await invalidateProjects()
      await queryClient.invalidateQueries({ queryKey: ['repository'] })
      return queryClient.ensureQueryData(projectsOptions)
    },
    createProject: createProject.mutateAsync,
    createProjectFromDirectory: createDirectory.mutateAsync,
    selectWorkspace: async (id: number): Promise<void> => {
      // Layout focus events re-select the workspace that is already active.
      if (queryClient.getQueryData(projectsOptions.queryKey)?.activeWorkspaceId === id) return
      await selectWorkspace.mutateAsync(id)
    },
    createWorkspace: (
      projectId: number,
      branch: string,
      from?: string | null
    ): Promise<Workspace> => createWorkspace.mutateAsync({ projectId, branch, from }),
    renameWorkspace: async (id: number, displayName: string | null): Promise<void> => {
      await renameWorkspace.mutateAsync({ id, displayName })
    },
    removeWorkspace: async (id: number, deleteFiles: boolean): Promise<void> => {
      await removeWorkspace.mutateAsync({ id, deleteFiles })
    },
    setWorkspaceStatus: async (id: number, status: WorkspaceStatus): Promise<void> => {
      await setStatus.mutateAsync({ id, status })
    },
    removeProject: async (id: number, deleteFiles: boolean): Promise<void> => {
      await removeProject.mutateAsync({ id, deleteFiles })
    },
    listProjectBranches: window.cerebro.listProjectBranches
  }
}
