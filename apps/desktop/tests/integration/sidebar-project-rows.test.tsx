import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, type RenderResult } from '@testing-library/react'
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
    }),
    workspace({
      id: 13,
      projectId: 1,
      repositoryId: 1,
      kind: 'worktree',
      branch: 'feature/quiet',
      localPath: '/tmp/notes-quiet',
      status: 'todo'
    }),
    workspace({
      id: 14,
      projectId: 1,
      repositoryId: 1,
      kind: 'worktree',
      branch: 'feature/done',
      localPath: '/tmp/notes-done',
      status: 'done'
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

/** Icon, name, and row buttons share one name line instead of a font baseline. */
function expectSharedNameLine(row: HTMLElement): void {
  const line = row.querySelector('[data-row-line]')
  expect(line).not.toBeNull()
  expect(line?.querySelector('[data-row-label]')?.textContent).toMatch(/\S/)
  expect(line?.querySelector('.align-baseline')).toBeNull()
}

function sidebarElement(
  sidebarGroupBy: SidebarGroupBy = 'project',
  activeWorkspaceId = 11
): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return (
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <AppSidebar
          mode="projects"
          projects={[notes, apps]}
          activeWorkspaceId={activeWorkspaceId}
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

function renderSidebar(
  sidebarGroupBy: SidebarGroupBy = 'project',
  activeWorkspaceId = 11
): RenderResult {
  return render(sidebarElement(sidebarGroupBy, activeWorkspaceId))
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

    const notesActions = notesRow
      .closest('[data-sidebar="menu-row"]')
      ?.querySelector('.sidebar-row-actions')
    expect(notesActions).toHaveAttribute('data-overlay')
    expect(notesActions?.querySelector('[data-testid="project-menu-1"]')).not.toBeNull()
    expect(notesActions?.querySelector('[data-testid="project-add-workspace-1"]')).not.toBeNull()
    expectSharedNameLine(notesRow)

    const mainRow = screen.getByTestId('workspace-row-11')
    const worktreeRow = screen.getByTestId('workspace-row-12')
    expectItemRow(mainRow, 'branch')
    expectItemRow(worktreeRow, 'branch')
    for (const row of [mainRow, worktreeRow]) {
      expectSharedNameLine(row)
      expect(row.querySelector('[data-row-icon]')).not.toBeNull()
      expect(row.querySelector('.align-baseline')).toBeNull()
      expect(
        row.closest('[data-sidebar="menu-row"]')?.querySelector('.sidebar-row-actions')
      ).toHaveAttribute('data-overlay')
    }

    await user.click(appsRow)
    const rootRow = screen.getByTestId('project-root-2')
    expectItemRow(rootRow, 'root')
    expectSharedNameLine(rootRow)
    expect(rootRow.querySelector('[data-row-icon]')).not.toBeNull()
    expect(rootRow.querySelector('.align-baseline')).toBeNull()
    expect(
      rootRow.closest('[data-sidebar="menu-row"]')?.querySelector('.sidebar-row-actions')
    ).not.toHaveAttribute('data-overlay')
    const repoRow = screen.getByTestId('workspace-row-22')
    expectItemRow(repoRow, 'repository')
    expectItemRow(screen.getByTestId('workspace-row-23'), 'repository')
    expectSharedNameLine(repoRow)
    const branchLine = screen.getByTestId('workspace-branch-22')
    expect(branchLine).toHaveAttribute('data-branch-line')
    expect(branchLine.querySelector('.align-baseline')).toBeNull()

    cleanup()
    renderSidebar('status')

    const statusNotes = screen.getByTestId('status-project-in_progress-1')
    const statusApps = screen.getByTestId('status-project-in_progress-2')
    expectSectionLabel(statusNotes)
    expectSectionLabel(statusApps)
    expect(statusNotes).toHaveAttribute('data-project-icon', 'avatar')
    expect(statusApps).toHaveAttribute('data-project-icon', 'folders')
    expect(statusApps.closest('[data-slot="collapsible"]')?.className).toContain('not-first:mt-2.5')
    expect(statusNotes.closest('[data-sidebar="status-projects"]')?.className).toContain('gap-0')

    const header = screen.getByTestId('status-group-in_progress')
    expect(header.className).toContain('sidebar-status-header')
    expect(header.className).not.toContain('sidebar-project-button')
    expect(header.className).not.toContain('text-sidebar-foreground/60')

    expectItemRow(screen.getByTestId('workspace-row-12'), 'branch')
    expectItemRow(screen.getByTestId('project-root-2'), 'root')

    const todoHeader = screen.getByTestId('status-group-todo')
    const doneHeader = screen.getByTestId('status-group-done')
    expect(todoHeader.className).toContain('text-sky-700')
    expect(todoHeader.className).not.toContain('text-sidebar-foreground/80')
    expect(doneHeader.className).toContain('text-sidebar-foreground/80')
    expect(doneHeader.className).not.toContain('text-sky-700')
    expect(screen.getByTestId('status-group-in_progress').className).toContain('text-amber-700')
    expect(screen.getByTestId('status-group-ready_to_review').className).toContain(
      'text-emerald-700'
    )
    expect(screen.getByTestId('status-count-todo').className).toContain('bg-sky-500/15')
    expect(screen.getByTestId('status-count-done').className).toContain('bg-sidebar-foreground/10')
    const todoIcon = todoHeader.querySelector('[data-workspace-status-icon="todo"] svg')
    const doneIcon = doneHeader.querySelector('[data-workspace-status-icon="done"] svg')
    expect(todoIcon?.getAttribute('class')).toContain('text-sky-500')
    expect(todoIcon?.getAttribute('class')).toContain('lucide-circle')
    expect(todoIcon?.getAttribute('class')).not.toContain('lucide-circle-check')
    expect(doneIcon?.getAttribute('class')).toContain('lucide-circle-check')

    const quietRow = screen.getByTestId('workspace-row-13')
    const selectedTodo = screen.getByTestId('workspace-row-11')
    const progressRow = screen.getByTestId('workspace-row-12')
    expect(quietRow).toHaveAttribute('data-todo-muted', 'true')
    expect(quietRow.className).toContain('text-sidebar-foreground/55')
    expect(screen.getByTestId('workspace-default-icon-13').className).toContain(
      'text-sidebar-foreground/45'
    )
    expect(selectedTodo).not.toHaveAttribute('data-todo-muted')
    expect(selectedTodo.className).not.toContain('text-sidebar-foreground/55')
    expect(selectedTodo).toHaveAttribute('aria-current', 'location')
    expect(progressRow).not.toHaveAttribute('data-todo-muted')
    expect(screen.getByTestId('status-project-todo-1').className).toContain(
      'text-sidebar-foreground/60'
    )
    expect(screen.getByTestId('status-project-todo-1').className).not.toContain(
      'text-sidebar-foreground/55'
    )

    expect(screen.getByTestId('status-project-in_progress-1')).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByTestId('status-project-menu-in_progress-1')).toBeInTheDocument()
    expect(screen.getByTestId('status-project-add-in_progress-1')).toBeInTheDocument()
    expect(screen.getByTestId('status-project-menu-in_progress-2')).toBeInTheDocument()
    expect(screen.queryByTestId('status-project-add-in_progress-2')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('status-project-in_progress-1'))
    expect(screen.getByTestId('status-project-in_progress-1')).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByTestId('workspace-row-12')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('status-project-in_progress-1'))
    expect(screen.getByTestId('workspace-row-12')).toBeInTheDocument()

    const scroll = screen.getByTestId('sidebar-status-scroll')
    expect(scroll).toContainElement(screen.getByTestId('status-group-in_progress'))
    expect(scroll).toContainElement(screen.getByTestId('status-group-ready_to_review'))
    // The selected workspace is Todo, and Done still starts open with its rows.
    expect(scroll).toContainElement(doneHeader)
    expect(doneHeader).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByTestId('status-done-pinned')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-row-14')).toBeInTheDocument()

    await user.click(screen.getByTestId('status-group-in_progress'))
    expect(screen.getByTestId('sidebar-status-scroll')).toContainElement(
      screen.getByTestId('status-group-in_progress')
    )
    expect(screen.getByTestId('sidebar-status-scroll')).toContainElement(
      screen.getByTestId('status-group-done')
    )

    await user.click(screen.getByTestId('status-group-done'))
    expect(screen.getByTestId('status-done-pinned')).toContainElement(
      screen.getByTestId('status-group-done')
    )
    expect(screen.getByTestId('sidebar-status-scroll')).not.toContainElement(
      screen.getByTestId('status-group-done')
    )
    expect(screen.getByTestId('status-group-done')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('workspace-row-14')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('status-group-done'))
    expect(screen.queryByTestId('status-done-pinned')).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-status-scroll')).toContainElement(
      screen.getByTestId('status-group-done')
    )
    expect(screen.getByTestId('status-group-done')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('workspace-row-14')).toBeInTheDocument()
  })

  it('keeps an expanded Done group in the scrolling list', () => {
    renderSidebar('status', 14)
    expect(screen.queryByTestId('status-done-pinned')).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-status-scroll')).toContainElement(
      screen.getByTestId('status-group-done')
    )
    expect(screen.getByTestId('status-group-done')).toHaveAttribute('aria-expanded', 'true')
  })

  it('reopens Done when the selected workspace moves into it', async () => {
    const user = userEvent.setup()
    const view = renderSidebar('status', 11)
    await user.click(screen.getByTestId('status-group-done'))
    expect(screen.getByTestId('status-group-done')).toHaveAttribute('aria-expanded', 'false')

    view.rerender(sidebarElement('status', 14))
    expect(screen.getByTestId('status-group-done')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByTestId('status-done-pinned')).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-status-scroll')).toContainElement(
      screen.getByTestId('status-group-done')
    )
    expect(screen.getByTestId('workspace-row-14')).toHaveAttribute('aria-current', 'location')
  })
})
