import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { LayoutState } from '@cerebro/core'
import type { Project, ProjectListResult } from '@shared/types'
import { useProjects } from '@/hooks/use-projects'
import {
  applyActiveWorkspace,
  applyOptimisticFocus,
  layoutOptions,
  projectsOptions,
  queryClient
} from '@/lib/query-client'

function workspace(id: number): Project['workspaces'][number] {
  return {
    id,
    projectId: 1,
    repositoryId: 1,
    kind: id === 11 ? 'default' : 'worktree',
    branch: `branch-${id}`,
    localPath: `/repo-${id}`,
    status: 'todo',
    displayName: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    pullRequest: null
  }
}

const project: Project = {
  id: 1,
  name: 'repo',
  kind: 'clone',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  github: null,
  repositories: [],
  workspaces: [workspace(11), workspace(12)]
}

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const activeId = (): number | null | undefined =>
  queryClient.getQueryData<ProjectListResult>(projectsOptions.queryKey)?.activeWorkspaceId

beforeEach(() => {
  queryClient.clear()
  window.cerebro = {
    listProjects: async () => ({ projects: [project], activeWorkspaceId: 11 }),
    listWorkspaceRepositories: async () => []
  } as unknown as typeof window.cerebro
})

it('selects a workspace before the mux confirms it', async () => {
  let confirm: (value: { activeWorkspaceId: number }) => void = () => {}
  const setActiveWorkspace = vi.fn(
    () => new Promise<{ activeWorkspaceId: number }>((resolve) => (confirm = resolve))
  )
  window.cerebro.setActiveWorkspace = setActiveWorkspace
  const { result } = renderHook(() => useProjects(), { wrapper })
  await waitFor(() => expect(result.current.activeWorkspaceId).toBe(11))

  let pending: Promise<void> = Promise.resolve()
  act(() => {
    pending = result.current.selectWorkspace(12)
  })
  await waitFor(() => expect(result.current.activeWorkspaceId).toBe(12))
  expect(setActiveWorkspace).toHaveBeenCalledWith(12)

  confirm({ activeWorkspaceId: 12 })
  await act(() => pending)
  expect(activeId()).toBe(12)
})

it('restores the previous workspace when the mux rejects the selection', async () => {
  window.cerebro.setActiveWorkspace = vi.fn(async () => {
    throw new Error('Workspace not found.')
  })
  const { result } = renderHook(() => useProjects(), { wrapper })
  await waitFor(() => expect(result.current.activeWorkspaceId).toBe(11))

  await act(async () => {
    await result.current.selectWorkspace(12).catch(() => undefined)
  })
  expect(result.current.activeWorkspaceId).toBe(11)
})

it('skips the mux call when the workspace is already active', async () => {
  const setActiveWorkspace = vi.fn(async (id: number) => ({ activeWorkspaceId: id }))
  window.cerebro.setActiveWorkspace = setActiveWorkspace
  const { result } = renderHook(() => useProjects(), { wrapper })
  await waitFor(() => expect(result.current.activeWorkspaceId).toBe(11))

  await act(() => result.current.selectWorkspace(11))
  expect(setActiveWorkspace).not.toHaveBeenCalled()
})

it('applies a selection-only invalidation without refetching projects', async () => {
  const listProjects = vi.fn(async () => ({ projects: [project], activeWorkspaceId: 11 }))
  window.cerebro.listProjects = listProjects
  const { result } = renderHook(() => useProjects(), { wrapper })
  await waitFor(() => expect(result.current.activeWorkspaceId).toBe(11))

  act(() => applyActiveWorkspace(12))
  await waitFor(() => expect(result.current.activeWorkspaceId).toBe(12))
  expect(listProjects).toHaveBeenCalledTimes(1)
})

const pane = (id: number): { type: 'pane'; id: number; kind: 'chat' } => ({
  type: 'pane',
  id,
  kind: 'chat'
})

function seedLayout(): void {
  const layout: LayoutState = {
    revision: 5,
    workspaces: {
      11: {
        activeTabId: 1,
        nextLabel: 3,
        tabs: [
          { id: 1, kind: 'chat', label: 'a', root: pane(10), activePaneId: 10 },
          {
            id: 2,
            kind: 'chat',
            label: 'b',
            root: {
              type: 'split',
              id: 99,
              direction: 'right',
              ratio: 0.5,
              first: pane(20),
              second: pane(21)
            },
            activePaneId: 20
          }
        ]
      }
    }
  }
  queryClient.setQueryData(layoutOptions.queryKey, layout)
}

it('shows tab and pane focus immediately and keeps the revision for reconciliation', () => {
  seedLayout()
  applyOptimisticFocus({ target: 'tab', action: 'focus', workspaceId: 11, tabId: 2 })
  let layout = queryClient.getQueryData<LayoutState>(layoutOptions.queryKey)!
  expect(layout.workspaces[11]?.activeTabId).toBe(2)
  expect(layout.workspaces[11]?.tabs[1]?.activePaneId).toBe(20)
  expect(layout.revision).toBe(5)

  applyOptimisticFocus({ target: 'pane', action: 'focus', workspaceId: 11, tabId: 2, paneId: 21 })
  layout = queryClient.getQueryData<LayoutState>(layoutOptions.queryKey)!
  expect(layout.workspaces[11]?.tabs[1]?.activePaneId).toBe(21)
})

it('ignores non-focus commands and unknown targets', () => {
  seedLayout()
  const before = queryClient.getQueryData(layoutOptions.queryKey)
  applyOptimisticFocus({ target: 'tab', action: 'close', workspaceId: 11, tabId: 2 })
  applyOptimisticFocus({ target: 'tab', action: 'focus', workspaceId: 11, tabId: 77 })
  applyOptimisticFocus({ target: 'tab', action: 'focus', workspaceId: 404, tabId: 1 })
  expect(queryClient.getQueryData(layoutOptions.queryKey)).toBe(before)
})
