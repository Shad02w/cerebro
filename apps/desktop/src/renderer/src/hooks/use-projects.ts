import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import type { Project, ProjectBranch, ProjectListResult, Workspace } from '@shared/types'
import {
  invalidateProjects,
  PR_REFRESH_MS,
  projectsOptions,
  pullRequestOptions,
  queryClient
} from '@/lib/query-client'

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

export function useProjects(): ProjectsState {
  const projectQuery = useQuery(projectsOptions)
  const repositoryQuery = useQuery({
    queryKey: ['workspace-repositories'],
    queryFn: () => window.cerebro.listWorkspaceRepositories(),
    enabled: !!projectQuery.data,
    refetchInterval: PR_REFRESH_MS,
    refetchIntervalInBackground: true
  })
  const repositories = [
    ...new Map(
      (repositoryQuery.data ?? []).flatMap((workspace) =>
        workspace.github
          ? [
              [
                `${workspace.github.owner.toLowerCase()}/${workspace.github.repo.toLowerCase()}`,
                workspace.github
              ] as const
            ]
          : []
      )
    ).values()
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
  const projects: Project[] = (projectQuery.data?.projects ?? []).map((project) => ({
    ...project,
    workspaces: project.workspaces.map((workspace): Workspace => {
      const identity = workspaceRepos.get(workspace.id)
      if (!identity?.github || !identity.branch) return { ...workspace, pullRequest: null }
      const query = queriesByRepo.get(
        `${identity.github.owner.toLowerCase()}/${identity.github.repo.toLowerCase()}`
      )
      const failed = query?.isError || repositoryQuery.isError
      return {
        ...workspace,
        branch: identity.branch,
        pullRequest: query?.data?.byBranch[identity.branch] ?? null,
        prStatus: {
          state: failed
            ? query?.data
              ? 'stale'
              : 'unavailable'
            : query?.data
              ? 'ready'
              : 'loading',
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
  const selectWorkspace = useMutation({
    mutationFn: (id: number) => window.cerebro.setActiveWorkspace(id),
    onSuccess: updateList
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
  const removeWorkspace = useMutation({
    mutationFn: ({ id, deleteFiles }: { id: number; deleteFiles: boolean }) =>
      window.cerebro.removeWorkspace(id, deleteFiles),
    onSuccess: async (result) => {
      await updateList(result)
      await invalidateProjects()
    }
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
      await selectWorkspace.mutateAsync(id)
    },
    createWorkspace: (
      projectId: number,
      branch: string,
      from?: string | null
    ): Promise<Workspace> => createWorkspace.mutateAsync({ projectId, branch, from }),
    removeWorkspace: async (id: number, deleteFiles: boolean): Promise<void> => {
      await removeWorkspace.mutateAsync({ id, deleteFiles })
    },
    removeProject: async (id: number, deleteFiles: boolean): Promise<void> => {
      await removeProject.mutateAsync({ id, deleteFiles })
    },
    listProjectBranches: window.cerebro.listProjectBranches
  }
}
