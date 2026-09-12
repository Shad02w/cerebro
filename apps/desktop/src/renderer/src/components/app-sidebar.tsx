import { useRef, useState } from 'react'
import '@/assets/sidebar.css'
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Folder,
  FolderPlus,
  Folders,
  FolderTree,
  GitBranch,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react'
import type { Project, Workspace } from '@shared/types'
import type { SettingsSectionId } from '@/lib/app-route'
import { SETTINGS_SECTIONS } from '@/lib/settings-sections'
import { Input } from '@/components/ui/input'
import { WorkspaceHoverCard } from '@/components/workspace-hover-card'
import { WorkspacePrPopover } from '@/components/workspace-pr-popover'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuRow,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail
} from '@/components/ui/sidebar'

const DEFAULT_WORKSPACE_TOOLTIP =
  "Default workspace — can't be deleted. Remove the project instead."

type AppSidebarProps = {
  mode: 'projects' | 'settings'
  projects: Project[]
  activeWorkspaceId: number | null
  settingsSection: SettingsSectionId
  onSelectWorkspace: (workspaceId: number) => void
  onAddProject: () => void
  onAddWorkspace: (project: Project) => void
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
  onRemoveWorkspace: (workspaceId: number, deleteFiles: boolean) => void
  onSelectSettingsSection: (section: SettingsSectionId) => void
  onOpenSettings: () => void
  onBack: () => void
}

function workspaceBasename(localPath: string): string | null {
  const base = localPath.split(/[\\/]/).filter(Boolean).at(-1)
  return base ?? null
}

function parentDirectory(localPath: string): string {
  const trimmed = localPath.replace(/[\\/]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slash <= 0) return trimmed
  return trimmed.slice(0, slash)
}

function multiRootDirectoryPath(project: Project): string {
  const sample = project.repositories[0]?.localPath ?? project.workspaces[0]?.localPath
  return sample ? parentDirectory(sample) : ''
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // Clipboard can be unavailable in locked-down environments.
  }
}

function isMultiRootProject(project: Project): boolean {
  return project.kind === 'multi-root' || project.repositories.length > 1
}

function rootWorkspaceOf(project: Project): Workspace | null {
  return project.workspaces.find((workspace) => workspace.kind === 'root') ?? null
}

function repositoryWorkspaces(project: Project): Workspace[] {
  return project.workspaces.filter((workspace) => workspace.kind !== 'root')
}

function PlusActionTooltip({
  label,
  children
}: {
  label: string
  children: React.ReactElement
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function workspaceLabel(project: Project, workspace: Workspace): string {
  if (!workspace.branch) return project.name
  return workspace.branch
}

function repositoryDirName(project: Project, workspace: Workspace): string {
  const repo = project.repositories.find(
    (item) => Number(item.id) === Number(workspace.repositoryId)
  )
  return repo?.name || workspaceBasename(workspace.localPath) || 'repo'
}

function DisabledDestructiveItem({
  testId,
  label
}: {
  testId: string
  label: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex w-full" data-testid={testId}>
          <DropdownMenuItem
            variant="destructive"
            disabled
            className="w-full"
            onSelect={(event): void => event.preventDefault()}
          >
            <Trash2 />
            {label}
          </DropdownMenuItem>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6}>
        {DEFAULT_WORKSPACE_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  )
}

function CopyMenuItems({
  branch,
  localPath,
  testIdPrefix
}: {
  branch: string | null
  localPath: string
  testIdPrefix: string
}): React.JSX.Element {
  const canCopyBranch = Boolean(branch)
  return (
    <>
      <DropdownMenuItem
        disabled={!canCopyBranch}
        data-testid={`${testIdPrefix}-copy-branch`}
        onClick={(event): void => {
          event.stopPropagation()
          if (branch) void copyToClipboard(branch)
        }}
      >
        <Copy />
        Copy branch name
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!localPath}
        data-testid={`${testIdPrefix}-copy-path`}
        onClick={(event): void => {
          event.stopPropagation()
          if (localPath) void copyToClipboard(localPath)
        }}
      >
        <Copy />
        Copy path
      </DropdownMenuItem>
    </>
  )
}

function ProjectOverflowMenu({
  project,
  offsetForAdd,
  onRemoveProject
}: {
  project: Project
  offsetForAdd: boolean
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
}): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          className={cn('app-no-drag', offsetForAdd && 'right-6')}
          showOnHover
          data-testid={`project-menu-${project.id}`}
          onClick={(event): void => event.stopPropagation()}
          onPointerDown={(event): void => event.stopPropagation()}
        >
          <MoreHorizontal />
          <span className="sr-only">Project actions</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-52">
        <DropdownMenuItem
          variant="destructive"
          data-testid={`project-delete-${project.id}`}
          onClick={(event): void => {
            event.stopPropagation()
            onRemoveProject(project.id, true)
          }}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          data-testid={`project-remove-${project.id}`}
          onClick={(event): void => {
            event.stopPropagation()
            onRemoveProject(project.id, false)
          }}
        >
          <Trash2 />
          Remove from app
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WorkspaceOverflowMenu({
  workspace,
  allowRemove = true,
  onRemoveWorkspace
}: {
  workspace: Workspace
  allowRemove?: boolean
  onRemoveWorkspace?: (workspaceId: number, deleteFiles: boolean) => void
}): React.JSX.Element {
  const isDefault = workspace.kind === 'default'

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          className="app-no-drag"
          showOnHover
          data-testid={`workspace-menu-${workspace.id}`}
          onClick={(event): void => event.stopPropagation()}
          onPointerDown={(event): void => event.stopPropagation()}
        >
          <MoreHorizontal />
          <span className="sr-only">Workspace actions</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-52">
        <CopyMenuItems
          branch={workspace.branch}
          localPath={workspace.localPath}
          testIdPrefix={`workspace-${workspace.id}`}
        />
        {allowRemove ? (
          <>
            <DropdownMenuSeparator />
            {isDefault ? (
              <>
                <DisabledDestructiveItem
                  testId={`workspace-delete-${workspace.id}`}
                  label="Delete"
                />
                <DisabledDestructiveItem
                  testId={`workspace-remove-${workspace.id}`}
                  label="Remove from app"
                />
              </>
            ) : (
              <>
                <DropdownMenuItem
                  variant="destructive"
                  data-testid={`workspace-delete-${workspace.id}`}
                  onClick={(event): void => {
                    event.stopPropagation()
                    onRemoveWorkspace?.(workspace.id, true)
                  }}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  data-testid={`workspace-remove-${workspace.id}`}
                  onClick={(event): void => {
                    event.stopPropagation()
                    onRemoveWorkspace?.(workspace.id, false)
                  }}
                >
                  <Trash2 />
                  Remove from app
                </DropdownMenuItem>
              </>
            )}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RootOverflowMenu({ project }: { project: Project }): React.JSX.Element {
  const root = rootWorkspaceOf(project)
  const localPath = root?.localPath || multiRootDirectoryPath(project)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          className="app-no-drag"
          showOnHover
          data-testid={`root-menu-${project.id}`}
          onClick={(event): void => event.stopPropagation()}
          onPointerDown={(event): void => event.stopPropagation()}
        >
          <MoreHorizontal />
          <span className="sr-only">Root workspace actions</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-52">
        <CopyMenuItems branch={null} localPath={localPath} testIdPrefix={`root-${project.id}`} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MultiRootRepoRow({
  project,
  workspace,
  active,
  onSelect
}: {
  project: Project
  workspace: Workspace
  active: boolean
  onSelect: (workspaceId: number) => void
}): React.JSX.Element {
  const name = repositoryDirName(project, workspace)
  const branch = workspace.branch.trim()

  return (
    <li className="relative">
      <WorkspaceHoverCard workspace={workspace}>
        <SidebarMenuRow data-workspace-id={workspace.id}>
          <button
            type="button"
            className={cn(
              'app-no-drag peer/menu-button flex w-full min-w-0 flex-col items-stretch rounded-md px-2 py-1.5 pr-8 text-left',
              'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
            data-testid={`workspace-row-${workspace.id}`}
            data-workspace-id={workspace.id}
            data-workspace-role="repository"
            data-workspace-icon="directory-name"
            data-active={active ? 'true' : 'false'}
            aria-current={active ? 'location' : undefined}
            onClick={(): void => onSelect(workspace.id)}
          >
            <span
              className="min-w-0 truncate text-[13px] font-medium leading-4"
              data-testid={`workspace-repo-${workspace.id}`}
            >
              {name}
            </span>
            {branch ? (
              <span
                className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-3 text-sidebar-foreground/65"
                data-testid={`workspace-branch-${workspace.id}`}
              >
                <span
                  aria-hidden
                  className="mb-px ml-0.5 h-2.5 w-2 shrink-0 rounded-bl-[3px] border-b border-l border-current opacity-40"
                />
                <span aria-hidden className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{branch}</span>
              </span>
            ) : null}
          </button>
          {branch ? (
            <WorkspacePrPopover
              workspace={workspace}
              className="absolute bottom-2 left-[22px] size-3"
            />
          ) : null}
          <WorkspaceOverflowMenu workspace={workspace} allowRemove={false} />
        </SidebarMenuRow>
      </WorkspaceHoverCard>
    </li>
  )
}

function MultiRootWorkspaceTree({
  project,
  activeWorkspaceId,
  onSelectWorkspace
}: {
  project: Project
  activeWorkspaceId: number | null
  onSelectWorkspace: (workspaceId: number) => void
}): React.JSX.Element {
  const [rootOpen, setRootOpen] = useState(true)
  const rootWorkspace = rootWorkspaceOf(project)
  const repos = repositoryWorkspaces(project)
  const rootActive = rootWorkspace != null && rootWorkspace.id === activeWorkspaceId

  return (
    <SidebarMenuSub>
      <SidebarMenuSubItem>
        <Collapsible
          open={rootOpen}
          onOpenChange={setRootOpen}
          className="sidebar-root-group"
          data-testid={`root-group-${project.id}`}
          role="group"
          aria-label={`${project.name} root workspace`}
        >
          <WorkspaceHoverCard workspace={rootWorkspace ?? undefined}>
            <SidebarMenuRow data-workspace-id={rootWorkspace?.id}>
              <button
                type="button"
                className={cn(
                  'app-no-drag peer/menu-button flex h-7 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 pr-14 text-left text-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
                data-testid={`project-root-${project.id}`}
                data-workspace-role="root"
                data-workspace-icon="folder-tree"
                data-workspace-id={rootWorkspace?.id}
                data-active={rootActive ? 'true' : 'false'}
                aria-current={rootActive ? 'location' : undefined}
                disabled={rootWorkspace == null}
                onClick={(event): void => {
                  event.stopPropagation()
                  if (rootWorkspace) onSelectWorkspace(rootWorkspace.id)
                }}
              >
                <FolderTree className="size-4 shrink-0 text-sidebar-accent-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">root</span>
                <span
                  className="shrink-0 text-[10px] text-sidebar-foreground/55 tabular-nums"
                  aria-label={`${repos.length} repositories in root`}
                  data-testid={`root-repo-count-${project.id}`}
                >
                  {repos.length} {repos.length === 1 ? 'repo' : 'repos'}
                </span>
              </button>
              <SidebarMenuAction
                className="app-no-drag right-6"
                data-testid={`root-toggle-${project.id}`}
                aria-expanded={rootOpen}
                aria-label={rootOpen ? 'Collapse repositories' : 'Expand repositories'}
                onClick={(event): void => {
                  event.stopPropagation()
                  setRootOpen((open) => !open)
                }}
                onPointerDown={(event): void => event.stopPropagation()}
              >
                <ChevronRight
                  className={cn('size-4 shrink-0 transition-transform', rootOpen && 'rotate-90')}
                />
                <span className="sr-only">
                  {rootOpen ? 'Collapse repositories' : 'Expand repositories'}
                </span>
              </SidebarMenuAction>
              <RootOverflowMenu project={project} />
            </SidebarMenuRow>
          </WorkspaceHoverCard>
          <CollapsibleContent>
            {repos.length > 0 ? (
              <ul
                className="ml-3 flex min-w-0 flex-col gap-1 pt-1 pb-0.5"
                aria-label="Repositories in root"
                data-testid={`project-repo-tree-${project.id}`}
              >
                {repos.map((workspace: Workspace) => (
                  <MultiRootRepoRow
                    key={workspace.id}
                    project={project}
                    workspace={workspace}
                    active={workspace.id === activeWorkspaceId}
                    onSelect={onSelectWorkspace}
                  />
                ))}
              </ul>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  )
}

function ProjectItem({
  project,
  activeWorkspaceId,
  defaultOpen,
  onSelectWorkspace,
  onAddWorkspace,
  onRemoveProject,
  onRemoveWorkspace
}: {
  project: Project
  activeWorkspaceId: number | null
  defaultOpen: boolean
  onSelectWorkspace: (workspaceId: number) => void
  onAddWorkspace: (project: Project) => void
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
  onRemoveWorkspace: (workspaceId: number, deleteFiles: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const githubLinked = project.github != null
  const multiRoot = isMultiRootProject(project)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <SidebarMenuRow>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              className={cn('app-no-drag sidebar-project-button', githubLinked && 'pr-14')}
              data-testid={`project-row-${project.id}`}
              data-project-kind={project.kind}
              data-project-icon={multiRoot ? 'folders' : 'folder'}
              title={multiRoot ? `${project.name} (multi-root)` : project.name}
            >
              {multiRoot ? <Folders /> : <Folder />}
              <span className="min-w-0 truncate">{project.name}</span>
              {multiRoot ? (
                <span
                  className="shrink-0 rounded-md bg-[color-mix(in_oklch,var(--sidebar-selected)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[var(--sidebar-selected)] uppercase"
                  data-testid={`project-multi-root-${project.id}`}
                >
                  multi-root
                </span>
              ) : null}
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <ProjectOverflowMenu
            project={project}
            offsetForAdd={githubLinked}
            onRemoveProject={onRemoveProject}
          />
          {githubLinked ? (
            <PlusActionTooltip label="Add workspace">
              <SidebarMenuAction
                className="app-no-drag"
                showOnHover
                data-testid={`project-add-workspace-${project.id}`}
                onClick={(event): void => {
                  event.stopPropagation()
                  onAddWorkspace(project)
                }}
              >
                <Plus />
                <span className="sr-only">Add workspace</span>
              </SidebarMenuAction>
            </PlusActionTooltip>
          ) : null}
        </SidebarMenuRow>
        <CollapsibleContent>
          {multiRoot ? (
            <MultiRootWorkspaceTree
              project={project}
              activeWorkspaceId={activeWorkspaceId}
              onSelectWorkspace={onSelectWorkspace}
            />
          ) : project.workspaces.length > 0 ? (
            <SidebarMenuSub>
              {project.workspaces.map((workspace: Workspace) => (
                <SidebarMenuSubItem key={workspace.id}>
                  <WorkspaceHoverCard workspace={workspace}>
                    <SidebarMenuRow data-workspace-id={workspace.id}>
                      <SidebarMenuSubButton
                        size="sm"
                        asChild
                        isActive={workspace.id === activeWorkspaceId}
                      >
                        <button
                          type="button"
                          className="app-no-drag flex w-full min-w-0 items-center gap-2 pr-8 pl-8"
                          data-testid={`workspace-row-${workspace.id}`}
                          data-workspace-id={workspace.id}
                          aria-current={workspace.id === activeWorkspaceId ? 'location' : undefined}
                          data-workspace-role="branch"
                          data-workspace-icon="branch"
                          onClick={(): void => onSelectWorkspace(workspace.id)}
                        >
                          <span className="min-w-0 flex-1 truncate text-left">
                            {workspaceLabel(project, workspace)}
                          </span>
                        </button>
                      </SidebarMenuSubButton>
                      <WorkspacePrPopover
                        workspace={workspace}
                        className="absolute top-1/2 left-2 size-4 -translate-y-1/2"
                      />
                      <WorkspaceOverflowMenu
                        workspace={workspace}
                        onRemoveWorkspace={onRemoveWorkspace}
                      />
                    </SidebarMenuRow>
                  </WorkspaceHoverCard>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          ) : null}
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

type WorkspaceSearchResult = { project: Project; workspace: Workspace; label: string }

function searchWorkspaces(projects: Project[], query: string): WorkspaceSearchResult[] {
  if (!query) return []
  return projects.flatMap((project) =>
    project.workspaces.flatMap((workspace) => {
      const label =
        workspace.kind === 'root'
          ? 'root'
          : isMultiRootProject(project)
            ? [repositoryDirName(project, workspace), workspace.branch].filter(Boolean).join(' · ')
            : workspaceLabel(project, workspace)
      return `${project.name} ${label}`.toLowerCase().includes(query)
        ? [{ project, workspace, label }]
        : []
    })
  )
}

function NavigationHeader({
  isSettings,
  projectCount,
  search,
  onSearchChange,
  onAddProject,
  firstResultId,
  onSelectWorkspace
}: {
  isSettings: boolean
  projectCount: number
  search: string
  onSearchChange: (value: string) => void
  onAddProject: () => void
  firstResultId: number | undefined
  onSelectWorkspace: (workspaceId: number) => void
}): React.JSX.Element {
  const searchInput = useRef<HTMLInputElement>(null)
  return (
    <SidebarHeader className="gap-2 px-3 pt-12 pb-1">
      <div className="app-drag-region flex h-8 items-center gap-2 px-2">
        <h2 className="flex-1 text-sm font-semibold" data-testid="sidebar-heading">
          {isSettings ? 'Settings' : 'Projects'}
        </h2>
        {!isSettings ? (
          <>
            <span
              className="text-xs text-sidebar-foreground/50 tabular-nums"
              aria-label={`${projectCount} projects`}
            >
              {projectCount}
            </span>
            <PlusActionTooltip label="Add project">
              <button
                type="button"
                className="app-no-drag sidebar-header-action -mr-1"
                onClick={onAddProject}
                aria-label="Add project"
              >
                <FolderPlus className="size-4" />
              </button>
            </PlusActionTooltip>
          </>
        ) : null}
      </div>
      {!isSettings ? (
        <div className="app-no-drag relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-sidebar-foreground/50"
          />
          <Input
            ref={searchInput}
            aria-label="Search projects and workspaces"
            placeholder="Find a workspace…"
            value={search}
            className="h-8 rounded-md pr-8 pl-8 text-xs shadow-none md:text-xs"
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape') {
                event.preventDefault()
                onSearchChange('')
              } else if (event.key === 'Enter' && firstResultId != null) {
                event.preventDefault()
                onSelectWorkspace(firstResultId)
              }
            }}
          />
          {search ? (
            <button
              type="button"
              className="sidebar-header-action absolute top-1/2 right-0.5 -translate-y-1/2"
              aria-label="Clear search"
              onClick={() => {
                onSearchChange('')
                searchInput.current?.focus()
              }}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </SidebarHeader>
  )
}

function WorkspaceSearchResults({
  results,
  activeWorkspaceId,
  onSelectWorkspace
}: {
  results: WorkspaceSearchResult[]
  activeWorkspaceId: number | null
  onSelectWorkspace: (workspaceId: number) => void
}): React.JSX.Element {
  return (
    <div>
      <p role="status" className="px-2 pt-1 pb-2 text-xs text-sidebar-foreground/60">
        {results.length === 0
          ? 'No matching workspaces'
          : `${results.length} ${results.length === 1 ? 'workspace' : 'workspaces'} found`}
      </p>
      <SidebarMenu>
        {results.map(({ project, workspace, label }) => (
          <SidebarMenuItem key={workspace.id}>
            <WorkspaceHoverCard workspace={workspace}>
              <SidebarMenuButton
                className="app-no-drag h-auto min-h-12 items-start py-2"
                isActive={workspace.id === activeWorkspaceId}
                aria-current={workspace.id === activeWorkspaceId ? 'location' : undefined}
                onClick={() => onSelectWorkspace(workspace.id)}
                data-testid={`workspace-search-result-${workspace.id}`}
              >
                {workspace.kind === 'root' ? (
                  <FolderTree className="mt-0.5" />
                ) : (
                  <GitBranch className="mt-0.5" />
                )}
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-xs font-medium">{label}</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/60">
                    {project.name}
                  </span>
                </span>
              </SidebarMenuButton>
            </WorkspaceHoverCard>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </div>
  )
}

export function AppSidebar({
  mode,
  projects,
  activeWorkspaceId,
  settingsSection,
  onSelectWorkspace,
  onAddProject,
  onAddWorkspace,
  onRemoveProject,
  onRemoveWorkspace,
  onSelectSettingsSection,
  onOpenSettings,
  onBack
}: AppSidebarProps): React.JSX.Element {
  const isSettings = mode === 'settings'
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const results = searchWorkspaces(projects, query)

  return (
    <Sidebar
      collapsible={isSettings ? 'none' : 'offcanvas'}
      className={cn('cerebro-sidebar', isSettings && 'border-r border-sidebar-border')}
    >
      <NavigationHeader
        isSettings={isSettings}
        projectCount={projects.length}
        search={search}
        onSearchChange={setSearch}
        onAddProject={onAddProject}
        firstResultId={results[0]?.workspace.id}
        onSelectWorkspace={onSelectWorkspace}
      />
      <SidebarContent>
        {isSettings ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {SETTINGS_SECTIONS.map((section) => {
                  const Icon = section.icon
                  return (
                    <SidebarMenuItem key={section.id}>
                      <SidebarMenuButton
                        className="app-no-drag"
                        size="sm"
                        isActive={section.id === settingsSection}
                        onClick={(): void => onSelectSettingsSection(section.id)}
                        data-testid={`settings-nav-${section.id}`}
                      >
                        <Icon />
                        <span>{section.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <SidebarGroup>
            <SidebarGroupContent>
              {query ? (
                <WorkspaceSearchResults
                  results={results}
                  activeWorkspaceId={activeWorkspaceId}
                  onSelectWorkspace={onSelectWorkspace}
                />
              ) : null}
              {projects.length === 0 ? (
                <p
                  className={cn(
                    'px-2 py-1.5 text-xs text-sidebar-foreground/60',
                    query && 'hidden'
                  )}
                >
                  No projects yet. Use + to clone a repository or open a folder.
                </p>
              ) : (
                <SidebarMenu className={query ? 'hidden' : 'gap-1'}>
                  {projects.map((project) => {
                    const containsActive = project.workspaces.some(
                      (workspace) => workspace.id === activeWorkspaceId
                    )
                    return (
                      <ProjectItem
                        key={project.id}
                        project={project}
                        activeWorkspaceId={activeWorkspaceId}
                        defaultOpen={containsActive || projects.length === 1}
                        onSelectWorkspace={onSelectWorkspace}
                        onAddWorkspace={onAddWorkspace}
                        onRemoveProject={onRemoveProject}
                        onRemoveWorkspace={onRemoveWorkspace}
                      />
                    )
                  })}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="mx-3 border-t border-sidebar-border px-0 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            {isSettings ? (
              <SidebarMenuButton className="app-no-drag" onClick={onBack}>
                <ArrowLeft />
                <span>Back</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                className="app-no-drag"
                onClick={onOpenSettings}
                data-testid="settings-button"
              >
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      {isSettings ? null : <SidebarRail />}
    </Sidebar>
  )
}
