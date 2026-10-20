import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Project, WorkspacePullRequest } from '@shared/types'
import { useProjects } from '@/hooks/use-projects'

const pullRequest: WorkspacePullRequest = {
  number: 42,
  title: 'Add frontend checkout',
  url: 'https://github.com/acme/frontend/pull/42',
  createdAt: '2024-01-01T00:00:00.000Z',
  state: 'open',
  isDraft: false,
  reviewDecision: 'approved',
  mergeable: true,
  ciStatus: 'success',
  ciChecks: [],
  ciCheckCount: 0,
  repoFullName: 'acme/frontend'
}

const project: Project = {
  id: 1,
  name: 'apps',
  kind: 'directory',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  github: null,
  repositories: [
    {
      id: 1,
      projectId: 1,
      gitUrl: 'file:///apps',
      name: 'apps',
      localPath: '/apps',
      defaultBranch: '',
      createdAt: '2024-01-01T00:00:00.000Z'
    }
  ],
  workspaces: [
    {
      id: 11,
      projectId: 1,
      repositoryId: 1,
      kind: 'default',
      branch: '',
      localPath: '/apps',
      status: 'todo',
      displayName: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      pullRequest: null
    }
  ],
  nestedRepos: [
    {
      name: 'frontend',
      branch: 'feature/labels',
      localPath: '/apps/frontend',
      github: { owner: 'Acme', repo: 'Frontend' }
    },
    { name: 'backend', branch: 'develop', localPath: '/apps/backend', github: null }
  ]
}

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  window.cerebro = {
    listProjects: async () => ({ projects: [project], activeWorkspaceId: null }),
    listWorkspaceRepositories: async () => [],
    getRepositoryPullRequests: vi.fn(async () => ({
      provider: 'github-app' as const,
      available: true,
      checkedAt: '2024-01-01T00:00:00.000Z',
      byBranch: { 'feature/labels': pullRequest },
      issues: []
    }))
  } as unknown as typeof window.cerebro
})

it('attaches branch pull requests to nested repositories', async () => {
  const { result } = renderHook(() => useProjects(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await waitFor(() =>
    expect(result.current.projects[0]?.nestedRepos?.[0]?.pullRequest).toEqual(pullRequest)
  )
  expect(window.cerebro.getRepositoryPullRequests).toHaveBeenCalledWith('acme', 'frontend')
  expect(result.current.projects[0]?.nestedRepos?.[0]?.prStatus?.state).toBe('ready')
  expect(result.current.projects[0]?.nestedRepos?.[1]?.pullRequest).toBeNull()
})
