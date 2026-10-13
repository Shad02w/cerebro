import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SidebarGroupBy } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Workspace } from '@shared/types'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'

function workspace(
  partial: Pick<Workspace, 'id' | 'projectId' | 'repositoryId' | 'kind' | 'branch' | 'localPath'> &
    Partial<Workspace>
): Workspace {
  return {
    status: 'todo',
    displayName: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    pullRequest: null,
    ...partial
  }
}

const notes: Project = {
  id: 1,
  name: 'notes',
  kind: 'clone',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  github: { owner: 'acme', repo: 'notes' },
  repositories: [
    {
      id: 1,
      projectId: 1,
      gitUrl: 'https://github.com/acme/notes.git',
      name: 'notes',
      localPath: '/tmp/notes',
      defaultBranch: 'main',
      createdAt: '2024-01-01T00:00:00.000Z'
    }
  ],
  workspaces: [
    workspace({
      id: 11,
      projectId: 1,
      repositoryId: 1,
      kind: 'default',
      branch: 'main',
      localPath: '/tmp/notes'
    }),
    workspace({
      id: 12,
      projectId: 1,
      repositoryId: 1,
      kind: 'worktree',
      branch: 'feature/labels',
      localPath: '/tmp/notes-labels',
      status: 'in_progress'
    })
  ]
}

const apps: Project = {
  id: 2,
  name: 'apps',
  kind: 'multi-root',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  github: null,
  repositories: [
    {
      id: 2,
      projectId: 2,
      gitUrl: 'https://github.com/acme/web.git',
      name: 'web',
      localPath: '/tmp/apps/web',
      defaultBranch: 'main',
      createdAt: '2024-01-01T00:00:00.000Z'
    },
    {
      id: 3,
      projectId: 2,
      gitUrl: 'https://github.com/acme/api.git',
      name: 'api',
      localPath: '/tmp/apps/api',
      defaultBranch: 'main',
      createdAt: '2024-01-01T00:00:00.000Z'
    }
  ],
  workspaces: [
    workspace({
      id: 21,
      projectId: 2,
      repositoryId: 2,
      kind: 'root',
      branch: '.',
      localPath: '/tmp/apps',
      status: 'in_progress'
    }),
    workspace({
      id: 22,
      projectId: 2,
      repositoryId: 2,
      kind: 'default',
      branch: 'main',
      localPath: '/tmp/apps/web'
    }),
    workspace({
      id: 23,
      projectId: 2,
      repositoryId: 3,
      kind: 'default',
      branch: 'main',
      localPath: '/tmp/apps/api'
    })
  ]
}

function expectSectionLabel(row: HTMLElement): void {
  expect(row.className).toContain('sidebar-project-button')
  expect(row.className).toContain('text-xs')
  expect(row.className).toContain('font-medium')
  expect(row.className).toContain('text-sidebar-foreground/60')
  expect(row.className).toContain('bg-transparent')
  expect(row.className).toContain('hover:bg-transparent')
  expect(row.className).not.toContain('border-l')
}

function expectItemRow(row: HTMLElement, role: string): void {
  expect(row).toHaveAttribute('data-workspace-role', role)
  expect(row.className).not.toContain('sidebar-project-button')
  expect(row.className).not.toContain('text-sidebar-foreground/60')
}

function renderSidebar(sidebarGroupBy: SidebarGroupBy = 'project'): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <AppSidebar
          mode="projects"
          projects={[notes, apps]}
          activeWorkspaceId={11}
          settingsSection="general"
          onSelectWorkspace={vi.fn()}
          onAddProject={vi.fn()}
          onAddWorkspace={vi.fn()}
          onRenameWorkspace={vi.fn(async () => {})}
          onRemoveProject={vi.fn()}
          onRemoveWorkspace={vi.fn()}
          onSetWorkspaceStatus={vi.fn()}
          sidebarGroupBy={sidebarGroupBy}
          onSidebarGroupBy={vi.fn()}
          onSelectSettingsSection={vi.fn()}
          onOpenSettings={vi.fn()}
          onBack={vi.fn()}
        />
      </SidebarProvider>
    </QueryClientProvider>
  )
}

describe('sidebar project rows', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    window.cerebro = {
      chatOverview: async () => ({ workspaces: [] })
    } as unknown as typeof window.cerebro
  })

  it('treats project rows as section labels and workspace rows as items', async () => {
    const user = userEvent.setup()
    renderSidebar()

    const notesRow = screen.getByTestId('project-row-1')
    const appsRow = screen.getByTestId('project-row-2')
    expectSectionLabel(notesRow)
    expectSectionLabel(appsRow)
    expect(notesRow).toHaveAttribute('data-project-icon', 'avatar')
    expect(appsRow).toHaveAttribute('data-project-icon', 'folders')
    expect(appsRow.querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('project-add-workspace-1')).toBeInTheDocument()
    expect(screen.getByTestId('project-menu-1')).toBeInTheDocument()

    const notesGroup = notesRow.closest('[data-slot="collapsible"]')
    const appsGroup = appsRow.closest('[data-slot="collapsible"]')
    expect(notesGroup?.className).toContain('not-first:mt-2.5')
    expect(appsGroup?.className).toContain('not-first:mt-2.5')
    expect(notesRow.closest('[data-sidebar="menu"]')?.className).toContain('gap-0')

    const mainRow = screen.getByTestId('workspace-row-11')
    const worktreeRow = screen.getByTestId('workspace-row-12')
    expectItemRow(mainRow, 'branch')
    expectItemRow(worktreeRow, 'branch')
    expect(mainRow.closest('[data-workspace-lines]')).toHaveAttribute('data-workspace-lines', '1')
    expect(worktreeRow.closest('[data-workspace-lines]')).toHaveAttribute(
      'data-workspace-lines',
      '1'
    )

    await user.click(appsRow)
    const rootRow = screen.getByTestId('project-root-2')
    expectItemRow(rootRow, 'root')
    expect(rootRow.closest('[data-workspace-lines]')).toHaveAttribute('data-workspace-lines', '1')
    expectItemRow(screen.getByTestId('workspace-row-22'), 'repository')
    expectItemRow(screen.getByTestId('workspace-row-23'), 'repository')

    cleanup()
    renderSidebar('status')

    const statusNotes = screen.getByTestId('status-project-in_progress-1')
    const statusApps = screen.getByTestId('status-project-in_progress-2')
    expectSectionLabel(statusNotes)
    expectSectionLabel(statusApps)
    expect(statusNotes).toHaveAttribute('data-project-icon', 'avatar')
    expect(statusApps).toHaveAttribute('data-project-icon', 'folders')
    expect(statusApps.closest('li')?.className).toContain('not-first:mt-2.5')
    expect(statusNotes.closest('[data-sidebar="status-projects"]')?.className).toContain('gap-0')

    const header = screen.getByTestId('status-group-in_progress')
    expect(header.className).toContain('sidebar-status-header')
    expect(header.className).not.toContain('sidebar-project-button')
    expect(header.className).not.toContain('text-sidebar-foreground/60')

    expectItemRow(screen.getByTestId('workspace-row-12'), 'branch')
    expectItemRow(screen.getByTestId('project-root-2'), 'root')
  })
})
