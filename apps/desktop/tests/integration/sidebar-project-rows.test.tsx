import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SidebarGroupBy } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Workspace } from '@shared/types'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { KeybindProvider } from '@/keybinds'

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

const scratch: Project = {
  id: 2,
  name: 'scratch',
  kind: 'directory',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  github: null,
  repositories: [
    {
      id: 2,
      projectId: 2,
      gitUrl: 'file:///tmp/scratch',
      name: 'scratch',
      localPath: '/tmp/scratch',
      defaultBranch: '',
      createdAt: '2024-01-01T00:00:00.000Z'
    }
  ],
  workspaces: [
    workspace({
      id: 21,
      projectId: 2,
      repositoryId: 2,
      kind: 'default',
      branch: '',
      localPath: '/tmp/scratch',
      status: 'in_progress'
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
  activeWorkspaceId = 11,
  projects: Project[] = [notes, scratch],
  onSelectWorkspace: (workspaceId: number) => void = vi.fn()
): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return (
    <QueryClientProvider client={client}>
      <KeybindProvider overrides={null}>
        <SidebarProvider>
          <AppSidebar
            mode="projects"
            projects={projects}
            activeWorkspaceId={activeWorkspaceId}
            settingsSection="general"
            onSelectWorkspace={onSelectWorkspace}
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
      </KeybindProvider>
    </QueryClientProvider>
  )
}

function renderSidebar(
  sidebarGroupBy: SidebarGroupBy = 'project',
  activeWorkspaceId = 11,
  projects?: Project[]
): RenderResult {
  return render(sidebarElement(sidebarGroupBy, activeWorkspaceId, projects))
}

describe('sidebar project rows', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    window.cerebro = {
      chatOverview: async () => ({ workspaces: [] }),
      onMenuClose: () => () => {}
    } as unknown as typeof window.cerebro
  })

  it('treats project rows as section labels and workspace rows as items', async () => {
    const user = userEvent.setup()
    renderSidebar()

    const notesRow = screen.getByTestId('project-row-1')
    const scratchRow = screen.getByTestId('workspace-row-21')
    expectSectionLabel(notesRow)
    expectItemRow(scratchRow, 'directory')
    expect(notesRow).toHaveAttribute('data-project-icon', 'avatar')
    expect(scratchRow).toHaveAttribute('data-workspace-icon', 'folder')
    expect(scratchRow).toHaveAttribute('data-project-kind', 'directory')
    expect(screen.queryByTestId('project-row-2')).not.toBeInTheDocument()
    expect(screen.getByTestId('project-add-workspace-1')).toBeInTheDocument()
    expect(screen.getByTestId('project-menu-1')).toBeInTheDocument()

    const notesGroup = notesRow.closest('[data-slot="collapsible"]')
    expect(notesGroup?.className).toContain('not-first:mt-2.5')
    expect(scratchRow.closest('[data-sidebar="menu-item"]')?.className).toContain(
      'not-first:mt-2.5'
    )
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

    expectSharedNameLine(scratchRow)
    expect(scratchRow.querySelector('[data-row-icon], svg')).not.toBeNull()

    cleanup()
    renderSidebar('status')

    const statusNotes = screen.getByTestId('status-project-in_progress-1')
    const statusScratch = screen.getByTestId('workspace-row-21')
    expectSectionLabel(statusNotes)
    expectItemRow(statusScratch, 'directory')
    expect(statusNotes).toHaveAttribute('data-project-icon', 'avatar')
    expect(statusScratch).toHaveAttribute('data-workspace-icon', 'folder')
    expect(statusScratch.closest('[data-sidebar="menu-item"]')?.className).toContain(
      'not-first:mt-2.5'
    )
    expect(statusNotes.closest('[data-sidebar="status-projects"]')?.className).toContain('gap-0')

    const header = screen.getByTestId('status-group-in_progress')
    expect(header.className).toContain('sidebar-status-header')
    expect(header.className).not.toContain('sidebar-project-button')
    expect(header.className).not.toContain('text-sidebar-foreground/60')

    expectItemRow(screen.getByTestId('workspace-row-12'), 'branch')
    expectItemRow(screen.getByTestId('workspace-row-21'), 'directory')

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
    expect(screen.getByTestId('workspace-menu-21')).toBeInTheDocument()
    expect(screen.queryByTestId('status-project-in_progress-2')).not.toBeInTheDocument()

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

  it('lists child repositories inside the directory row instead of as their own projects', async () => {
    const apps: Project = {
      ...scratch,
      id: 4,
      name: 'apps-folder',
      nestedRepos: [
        { name: 'frontend', branch: 'main', localPath: '/tmp/apps-folder/frontend' },
        { name: 'backend', branch: 'develop', localPath: '/tmp/apps-folder/backend' }
      ],
      repositories: [
        {
          ...scratch.repositories[0]!,
          id: 4,
          projectId: 4,
          name: 'apps-folder',
          localPath: '/tmp/apps-folder'
        }
      ],
      workspaces: [
        workspace({
          id: 41,
          projectId: 4,
          repositoryId: 4,
          kind: 'default',
          branch: '',
          localPath: '/tmp/apps-folder'
        })
      ]
    }
    const frontend: Project = {
      ...notes,
      id: 5,
      name: 'frontend',
      github: null,
      kind: 'directory',
      repositories: [
        {
          ...notes.repositories[0]!,
          id: 5,
          projectId: 5,
          name: 'frontend',
          localPath: '/tmp/apps-folder/frontend',
          defaultBranch: 'main'
        }
      ],
      workspaces: [
        workspace({
          id: 51,
          projectId: 5,
          repositoryId: 5,
          kind: 'default',
          branch: 'main',
          localPath: '/tmp/apps-folder/frontend'
        })
      ]
    }

    const user = userEvent.setup()
    const onSelectWorkspace = vi.fn()
    render(sidebarElement('project', 41, [apps, frontend, notes], onSelectWorkspace))

    const row = screen.getByTestId('workspace-row-41')
    expectSectionLabel(row)
    expect(row).toHaveAttribute('data-workspace-role', 'directory')
    const menuRow = row.closest('[data-sidebar="menu-row"]')
    const nameLine = screen
      .getByTestId('workspace-search-sessions-41')
      .closest('[data-directory-name-line]')
    const group = screen.getByTestId('workspace-root-41')
    expect(menuRow).not.toContainElement(screen.getByTestId('workspace-nested-repo-frontend'))
    expect(nameLine).not.toContainElement(screen.getByTestId('workspace-nested-repos-41'))
    expect(menuRow).toContainElement(screen.getByTestId('workspace-search-sessions-41'))
    expect(nameLine?.querySelector('.sidebar-row-actions')).toHaveAttribute('data-overlay', '')
    expect(nameLine).toContainElement(screen.getByTestId('workspace-multi-root-41'))
    expect(screen.getByTestId('workspace-row-41')).not.toContainElement(
      screen.getByTestId('workspace-multi-root-41')
    )
    const nestedList = screen.getByTestId('workspace-nested-repos-41')
    expect(nestedList.className).toContain('sidebar-nested-repos')
    expect(nestedList.className).not.toContain('-mx-1')
    expect(group).toContainElement(screen.getByTestId('workspace-nested-repo-frontend'))
    expect(group).toContainElement(screen.getByTestId('workspace-nested-branch-backend'))
    expect(screen.getByTestId('workspace-nested-branch-backend')).toHaveTextContent('develop')
    const frontendRow = screen.getByTestId('workspace-row-51')
    expect(frontendRow.className).toContain('rounded-md')
    expect(frontendRow.className).not.toContain('rounded-none')
    expect(frontendRow).toHaveAttribute('data-workspace-role', 'repository')
    expect(frontendRow.className).toContain('text-xs')
    expect(frontendRow.className).toContain('text-sidebar-foreground/60')
    const backendRow = screen.getByTestId('workspace-nested-repo-backend').querySelector('button')
    expect(backendRow).not.toBeNull()
    expect(backendRow).not.toHaveAttribute('data-workspace-id')
    expect(backendRow).toHaveAttribute('data-nested-path', '/tmp/apps-folder/backend')
    const createProjectFromDirectory = vi.fn(async () => ({
      workspaces: [
        workspace({
          id: 61,
          projectId: 6,
          repositoryId: 6,
          kind: 'default',
          branch: 'develop',
          localPath: '/tmp/apps-folder/backend'
        })
      ]
    }))
    window.cerebro = {
      ...window.cerebro,
      listProjects: async () => ({
        projects: [apps, frontend, notes],
        activeWorkspaceId: 41
      }),
      createProjectFromDirectory
    } as unknown as typeof window.cerebro
    backendRow!.focus()
    expect(backendRow).toHaveFocus()
    expect(onSelectWorkspace).not.toHaveBeenCalled()
    expect(createProjectFromDirectory).not.toHaveBeenCalled()
    await user.click(backendRow!)
    await waitFor(() => {
      expect(onSelectWorkspace).toHaveBeenCalledWith(61)
    })
    expect(createProjectFromDirectory).toHaveBeenCalledWith('/tmp/apps-folder/backend')
    expect(
      screen
        .getByTestId('workspace-nested-repo-backend')
        .querySelector('[data-workspace-role="repository"]')?.className
    ).toContain('text-sidebar-foreground/60')
    expect(screen.queryByTestId('project-row-5')).not.toBeInTheDocument()
    expect(screen.getByTestId('project-row-1')).toBeInTheDocument()

    await user.click(screen.getByTestId('workspace-nested-branch-frontend'))
    expect(onSelectWorkspace).toHaveBeenCalledWith(51)
    expect(createProjectFromDirectory).toHaveBeenCalledTimes(1)
  })

  it('collapses nested repositories without hiding the root sessions', async () => {
    const user = userEvent.setup()
    window.cerebro = {
      chatOverview: async () => ({
        workspaces: [
          {
            workspaceId: 41,
            agents: [
              {
                sessionId: 'session-1',
                workspaceId: 41,
                repositoryId: null,
                harness: 'claude',
                status: 'running',
                title: 'Extracting TDD',
                modelLabel: 'Opus',
                preview: '',
                paneId: 1,
                paneIds: [1]
              }
            ]
          }
        ]
      }),
      getLayout: async () => ({ workspaces: {} }),
      onMenuClose: () => () => {}
    } as unknown as typeof window.cerebro
    const apps: Project = {
      ...scratch,
      id: 4,
      name: 'apps-folder',
      nestedRepos: [{ name: 'frontend', branch: 'main', localPath: '/tmp/apps-folder/frontend' }],
      repositories: [
        {
          ...scratch.repositories[0]!,
          id: 4,
          projectId: 4,
          name: 'apps-folder',
          localPath: '/tmp/apps-folder'
        }
      ],
      workspaces: [
        workspace({
          id: 41,
          projectId: 4,
          repositoryId: 4,
          kind: 'default',
          branch: '',
          localPath: '/tmp/apps-folder'
        })
      ]
    }
    renderSidebar('project', 41, [apps])
    expect(await screen.findByText('Extracting TDD')).toBeInTheDocument()
    const sessions = screen.getByTestId('workspace-sessions')

    await user.click(screen.getByTestId('workspace-nested-toggle-41'))
    expect(screen.getByTestId('workspace-nested-toggle-41')).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByTestId('workspace-nested-repo-frontend')).not.toBeInTheDocument()
    expect(sessions).toBeInTheDocument()
    expect(screen.getByText('Extracting TDD')).toBeInTheDocument()
  })

  it('opens a project when selection moves to it and keeps a manual collapse', async () => {
    const user = userEvent.setup()
    const ledger: Project = {
      ...notes,
      id: 3,
      name: 'ledger',
      repositories: [
        {
          ...notes.repositories[0]!,
          id: 3,
          projectId: 3,
          name: 'ledger',
          localPath: '/tmp/ledger'
        }
      ],
      workspaces: [
        workspace({
          id: 31,
          projectId: 3,
          repositoryId: 3,
          kind: 'default',
          branch: 'main',
          localPath: '/tmp/ledger'
        })
      ]
    }
    const view = renderSidebar('project', 11, [notes, ledger])
    expect(screen.getByTestId('workspace-row-11')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-row-31')).not.toBeInTheDocument()

    view.rerender(sidebarElement('project', 31, [notes, ledger]))
    expect(screen.getByTestId('workspace-row-31')).toBeInTheDocument()

    await user.click(screen.getByTestId('project-row-3'))
    expect(screen.queryByTestId('workspace-row-31')).not.toBeInTheDocument()
    view.rerender(sidebarElement('project', 31, [notes, ledger]))
    expect(screen.queryByTestId('workspace-row-31')).not.toBeInTheDocument()
  })

  it('stays closed when the user collapsed it before it was selected', async () => {
    const user = userEvent.setup()
    const ledger: Project = {
      ...notes,
      id: 3,
      name: 'ledger',
      repositories: [
        {
          ...notes.repositories[0]!,
          id: 3,
          projectId: 3,
          name: 'ledger',
          localPath: '/tmp/ledger'
        }
      ],
      workspaces: [
        workspace({
          id: 31,
          projectId: 3,
          repositoryId: 3,
          kind: 'default',
          branch: 'main',
          localPath: '/tmp/ledger'
        })
      ]
    }
    const view = renderSidebar('project', 11, [notes, ledger])
    await user.click(screen.getByTestId('project-row-3'))
    expect(screen.getByTestId('workspace-row-31')).toBeInTheDocument()
    await user.click(screen.getByTestId('project-row-3'))
    expect(screen.queryByTestId('workspace-row-31')).not.toBeInTheDocument()

    view.rerender(sidebarElement('project', 31, [notes, ledger]))
    expect(screen.queryByTestId('workspace-row-31')).not.toBeInTheDocument()
  })
})
