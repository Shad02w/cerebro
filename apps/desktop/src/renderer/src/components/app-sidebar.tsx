import { useState } from 'react'
import {
  ArrowLeft,
  Copy,
  Folder,
  FolderPlus,
  Folders,
  FolderTree,
  GitBranch,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2
} from 'lucide-react'
import type { Project, Workspace } from '@shared/types'
import type { SettingsSectionId } from '@/lib/app-route'
import { SETTINGS_SECTIONS } from '@/lib/settings-sections'
import { BrainMark } from '@/components/brain-mark'
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
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
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
        <CopyMenuItems
          branch={null}
          localPath={multiRootDirectoryPath(project)}
          testIdPrefix={`root-${project.id}`}
        />
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
  const title = branch ? `${name} · ${branch}` : name

  return (
    <li className="relative">
      <SidebarMenuRow>
        <button
          type="button"
          className={cn(
            'app-no-drag peer/menu-button flex w-full min-w-0 flex-col items-stretch rounded-md px-2 py-1.5 pr-8 text-left',
            'bg-sidebar-accent/40 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            active && 'bg-sidebar-accent text-sidebar-accent-foreground'
          )}
          data-testid={`workspace-row-${workspace.id}`}
          data-workspace-role="repository"
          data-workspace-icon="directory-name"
          title={title}
          onClick={(): void => onSelect(workspace.id)}
        >
          <span
            className="min-w-0 truncate text-xs font-medium leading-4"
            data-testid={`workspace-repo-${workspace.id}`}
          >
            {name}
          </span>
          {branch ? (
            <span
              className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-sidebar-foreground/55"
              data-testid={`workspace-branch-${workspace.id}`}
            >
              <span
                aria-hidden
                className="mb-px ml-0.5 h-2.5 w-2 shrink-0 rounded-bl-[3px] border-b border-l border-current opacity-40"
              />
              <GitBranch className="size-2.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate">{branch}</span>
              <WorkspacePrPopover workspace={workspace} />
            </span>
          ) : (
            <WorkspacePrPopover workspace={workspace} />
          )}
        </button>
        <WorkspaceOverflowMenu workspace={workspace} allowRemove={false} />
      </SidebarMenuRow>
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

  return (
    <SidebarMenuSub>
      <SidebarMenuSubItem>
        <Collapsible open={rootOpen} onOpenChange={setRootOpen}>
          <SidebarMenuRow>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="app-no-drag peer/menu-button flex h-7 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 pr-8 text-left text-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                data-testid={`project-root-${project.id}`}
                data-workspace-role="root"
                data-workspace-icon="folder-tree"
              >
                <FolderTree className="size-4 shrink-0 text-sidebar-accent-foreground" />
                <span className="min-w-0 flex-1 truncate">root</span>
              </button>
            </CollapsibleTrigger>
            <RootOverflowMenu project={project} />
          </SidebarMenuRow>
          <CollapsibleContent>
            {project.workspaces.length > 0 ? (
              <ul
                className="ml-3 flex min-w-0 flex-col gap-1 py-1"
                data-testid={`project-repo-tree-${project.id}`}
              >
                {project.workspaces.map((workspace: Workspace) => (
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
              className={cn('app-no-drag', githubLinked && 'pr-14')}
              data-testid={`project-row-${project.id}`}
              data-project-kind={project.kind}
              data-project-icon={multiRoot ? 'folders' : 'folder'}
              title={multiRoot ? `${project.name} (multi-root)` : project.name}
            >
              {multiRoot ? <Folders /> : <Folder />}
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {multiRoot ? (
                <span
                  className="shrink-0 rounded-md bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-teal-700 uppercase dark:text-teal-300"
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
                  <SidebarMenuRow>
                    <SidebarMenuSubButton
                      size="sm"
                      asChild
                      isActive={workspace.id === activeWorkspaceId}
                    >
                      <button
                        type="button"
                        className="app-no-drag flex w-full min-w-0 items-center gap-2 pr-8"
                        data-testid={`workspace-row-${workspace.id}`}
                        data-workspace-role="branch"
                        data-workspace-icon="branch"
                        title={workspaceLabel(project, workspace)}
                        onClick={(): void => onSelectWorkspace(workspace.id)}
                      >
                        <GitBranch />
                        <span className="min-w-0 flex-1 truncate text-left">
                          {workspaceLabel(project, workspace)}
                        </span>
                        <WorkspacePrPopover workspace={workspace} />
                      </button>
                    </SidebarMenuSubButton>
                    <WorkspaceOverflowMenu
                      workspace={workspace}
                      onRemoveWorkspace={onRemoveWorkspace}
                    />
                  </SidebarMenuRow>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          ) : null}
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
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

  return (
    <Sidebar
      collapsible={isSettings ? 'none' : 'offcanvas'}
      className={isSettings ? 'border-r border-sidebar-border' : undefined}
    >
      <SidebarHeader className="pt-10">
        <div className="app-drag-region flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <BrainMark size="sm" testId="sidebar-brain-mark" className="text-sidebar-primary-foreground" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">Cerebro</span>
            <span className="truncate text-xs text-sidebar-foreground/70">Agentic development</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {isSettings ? (
          <SidebarGroup>
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
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
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <PlusActionTooltip label="Add project">
              <SidebarGroupAction className="app-no-drag" onClick={onAddProject}>
                <FolderPlus />
                <span className="sr-only">Add project</span>
              </SidebarGroupAction>
            </PlusActionTooltip>
            <SidebarGroupContent>
              {projects.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-sidebar-foreground/60">
                  No projects yet. Use + to clone a repository or open a folder.
                </p>
              ) : (
                <SidebarMenu>
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
      <SidebarFooter>
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
