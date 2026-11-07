import type { ReactNode } from 'react'
import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  GitBranch,
  PanelLeft,
  Search,
  Settings
} from 'lucide-react'
import type { Project, Workspace } from '@shared/types'
import { useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKbd, useKeybindBinding } from '@/keybinds'
import { openSessionSearch } from '@/lib/app-events'
import { cn } from '@/lib/utils'

/*
  Window chrome that some UI styles add around the sidebar and content area.
  Each piece only re-homes actions that already exist (toggle sidebar, search
  sessions, add project, settings); the project → workspace → thread tree stays
  in the sidebar.
*/

type ChromeActions = {
  isSettings: boolean
  onAddProject: () => void
  onOpenSettings: () => void
}

function workspaceLabel(workspace: Workspace): string {
  return (
    workspace.displayName ??
    (workspace.branch || workspace.localPath.split(/[\\/]/).pop() || 'Workspace')
  )
}

function RailButton({
  label,
  hotkey,
  active = false,
  onClick,
  children,
  testId
}: {
  label: string
  hotkey?: string
  active?: boolean
  onClick: () => void
  children: ReactNode
  testId: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            data-testid={testId}
            onClick={onClick}
            className={cn(
              'app-no-drag relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              active && 'bg-accent text-foreground'
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        {label}
        {hotkey ? <ShortcutKbd hotkey={hotkey} inverted /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** Editor style: a narrow activity bar to the left of the sidebar, like a code editor. */
export function ActivityRail({
  isSettings,
  onAddProject,
  onOpenSettings
}: ChromeActions): React.JSX.Element {
  const { open, toggleSidebar } = useSidebar()
  const searchHotkey = useKeybindBinding('searchSessions')
  const sidebarHotkey = useKeybindBinding('toggleSidebar')
  const settingsHotkey = useKeybindBinding('openSettings')
  return (
    <nav
      aria-label="Activity bar"
      data-testid="activity-rail"
      className="app-drag-region relative z-20 flex h-svh w-12 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-header pt-12 pb-3"
    >
      <RailButton
        label="Projects"
        hotkey={sidebarHotkey}
        active={open && !isSettings}
        onClick={toggleSidebar}
        testId="rail-projects"
      >
        <FolderOpen className="size-[18px]" />
      </RailButton>
      <RailButton
        label="Search sessions"
        hotkey={searchHotkey}
        onClick={openSessionSearch}
        testId="rail-search"
      >
        <Search className="size-[18px]" />
      </RailButton>
      <RailButton label="Add project" onClick={onAddProject} testId="rail-add-project">
        <FolderPlus className="size-[18px]" />
      </RailButton>
      <div className="flex-1" />
      <RailButton
        label="Settings"
        hotkey={settingsHotkey}
        active={isSettings}
        onClick={onOpenSettings}
        testId="rail-settings"
      >
        <Settings className="size-[18px]" />
      </RailButton>
    </nav>
  )
}

/** Editor style: a thin status bar under the content area with the active checkout. */
export function StatusBar({
  workspace,
  projects
}: {
  workspace: Workspace | null
  projects: Project[]
}): React.JSX.Element {
  const searchHotkey = useKeybindBinding('searchSessions')
  const project = workspace ? projects.find((item) => item.id === workspace.projectId) : null
  return (
    <footer
      data-testid="status-bar"
      className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-header px-3 text-[11px] text-muted-foreground"
    >
      {workspace ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
            <GitBranch className="size-3 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{workspace.branch || 'No branch'}</span>
          </span>
          {project ? <span className="truncate">{project.name}</span> : null}
          <span className="min-w-0 truncate font-mono">{workspace.localPath}</span>
        </>
      ) : (
        <span>No workspace selected</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        Search sessions <ShortcutKbd hotkey={searchHotkey} />
      </span>
    </footer>
  )
}

/** Indigo style: a full-width command bar in the title bar with a breadcrumb and global actions. */
export function CommandBar({
  isSettings,
  workspace,
  projects,
  onAddProject,
  onOpenSettings
}: ChromeActions & { workspace: Workspace | null; projects: Project[] }): React.JSX.Element {
  const { toggleSidebar } = useSidebar()
  const searchHotkey = useKeybindBinding('searchSessions')
  const project = workspace ? projects.find((item) => item.id === workspace.projectId) : null
  return (
    <header
      data-testid="command-bar"
      className="app-drag-region fixed inset-x-0 top-0 z-50 grid h-11 grid-cols-[1fr_minmax(16rem,28rem)_1fr] items-center gap-3 border-b border-border bg-sidebar pr-3 pl-[78px]"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <button
          type="button"
          aria-label="Toggle Sidebar"
          onClick={toggleSidebar}
          className="app-no-drag inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 pl-1">
          {isSettings ? (
            <span className="font-medium text-foreground">Settings</span>
          ) : workspace ? (
            <>
              <span className="truncate text-muted-foreground">{project?.name ?? 'Project'}</span>
              <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
              <span className="truncate font-medium text-foreground">
                {workspaceLabel(workspace)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No workspace selected</span>
          )}
        </nav>
      </div>
      <button
        type="button"
        onClick={openSessionSearch}
        data-testid="command-bar-search"
        className="app-no-drag flex h-7 w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground shadow-card transition-colors hover:border-ring hover:text-foreground"
      >
        <Search className="size-3.5" aria-hidden="true" />
        <span className="flex-1 text-left">Search sessions…</span>
        <ShortcutKbd hotkey={searchHotkey} />
      </button>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onAddProject}
          className="app-no-drag inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FolderPlus className="size-3.5" aria-hidden="true" />
          Add project
        </button>
        <button
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
          className={cn(
            'app-no-drag inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
            isSettings && 'bg-accent text-foreground'
          )}
        >
          <Settings className="size-4" />
        </button>
      </div>
    </header>
  )
}
