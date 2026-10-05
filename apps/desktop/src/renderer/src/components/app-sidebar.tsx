import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import type { ChatAgentActivity, LayoutState, PaneNode } from '@cerebro/core'
import {
  WORKSPACE_STATUSES,
  type Project,
  type SidebarGroupBy,
  type Workspace,
  type WorkspaceStatus
} from '@shared/types'
import type { SettingsSectionId } from '@/lib/app-route'
import { HarnessIcon, HarnessStatusIcon } from '@/components/harness-icon'
import { harnessLabels } from '@/components/chat/queries'
import { sortAgentActivity, useAgentActivity } from '@/lib/agent-activity'
import { acceptLayout, layoutOptions } from '@/lib/query-client'
import { SETTINGS_SECTIONS } from '@/lib/settings-sections'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import {
  WorkspaceRowStatusIcon,
  WorkspaceStatusIcon,
  WorkspaceStatusMenu
} from '@/components/workspace-status'
import {
  WORKSPACE_STATUS_PRESENTATION,
  workspaceCarriesStatus,
  workspaceStatus
} from '@/lib/workspace-status'
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
  onSetWorkspaceStatus: (workspaceId: number, status: WorkspaceStatus) => void
  sidebarGroupBy: SidebarGroupBy
  onSidebarGroupBy: (groupBy: SidebarGroupBy) => Promise<void> | void
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

function containsPane(node: PaneNode, paneId: number): boolean {
  if (node.type === 'pane') return node.id === paneId
  return containsPane(node.first, paneId) || containsPane(node.second, paneId)
}

function agentTabTitle(agent: ChatAgentActivity, layout: LayoutState | undefined): string {
  const fallback = agent.title.trim() || harnessLabels[agent.harness]
  const paneId = agent.paneId
  if (paneId == null || !layout) return fallback
  const label = layout.workspaces[agent.workspaceId]?.tabs
    .find((tab) => containsPane(tab.root, paneId))
    ?.label.trim()
  return label || fallback
}

function WorkspaceAgentIcon({
  agent,
  title,
  onOpenAgent
}: {
  agent: ChatAgentActivity
  title: string
  onOpenAgent: (agent: ChatAgentActivity) => void
}): React.JSX.Element {
  // Use a span so agent controls can live inside workspace <button> rows without
  // the HTML parser closing the row early and orphaning the status icons.
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          data-testid="workspace-agent-open"
          data-agent-title={title}
          aria-label={title}
          className="relative inline-flex shrink-0 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-selected"
          onPointerDown={(event): void => event.stopPropagation()}
          onClick={(event): void => {
            event.preventDefault()
            event.stopPropagation()
            onOpenAgent(agent)
          }}
          onKeyDown={(event): void => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            onOpenAgent(agent)
          }}
        >
          {agent.status === 'idle' ? (
            <span
              className="relative inline-flex size-4 shrink-0 pr-[3px] pb-[3px] box-content"
              data-agent-harness={agent.harness}
              data-workspace-agent-status="idle"
            >
              <HarnessIcon harness={agent.harness} />
            </span>
          ) : (
            <HarnessStatusIcon harness={agent.harness} status={agent.status} surface="sidebar" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        sideOffset={4}
        avoidCollisions={false}
        className="pointer-events-none max-w-64 text-wrap break-words"
      >
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

/** Keep the sidebar strip to one row; the rest are a +N glance cue. */
const WORKSPACE_AGENT_STRIP = 4

function WorkspaceAgents({
  agents,
  testId,
  className,
  onOpenAgent
}: {
  agents: ChatAgentActivity[]
  testId?: string
  className?: string
  onOpenAgent: (agent: ChatAgentActivity) => void
}): React.JSX.Element | null {
  const layout = useQuery(layoutOptions).data
  if (!agents.length) return null
  const visible = agents.slice(0, WORKSPACE_AGENT_STRIP)
  const overflow = agents.length - visible.length
  return (
    <div
      data-testid={testId}
      className={cn(
        'mt-1 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden',
        className
      )}
    >
      {visible.map((agent) => (
        <WorkspaceAgentIcon
          key={agent.paneId ?? agent.sessionId}
          agent={agent}
          title={agentTabTitle(agent, layout)}
          onOpenAgent={onOpenAgent}
        />
      ))}
      {overflow > 0 ? (
        <span
          data-testid="workspace-agent-overflow"
          className="shrink-0 text-[10px] tabular-nums text-sidebar-foreground/55"
          aria-label={`${overflow} more agent tabs`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
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
  project,
  onAddWorkspace,
  onRemoveWorkspace,
  onSetStatus
}: {
  workspace: Workspace
  allowRemove?: boolean
  project?: Project
  onAddWorkspace?: (project: Project) => void
  onRemoveWorkspace?: (workspaceId: number, deleteFiles: boolean) => void
  onSetStatus?: (workspaceId: number, status: WorkspaceStatus) => void
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
      <DropdownMenuContent align="start" side="right" className="w-56">
        {onSetStatus ? (
          <WorkspaceStatusMenu workspace={workspace} onSetStatus={onSetStatus} />
        ) : null}
        {project?.github && onAddWorkspace ? (
          <DropdownMenuItem
            data-testid={`workspace-add-${workspace.id}`}
            onClick={(event): void => {
              event.stopPropagation()
              onAddWorkspace(project)
            }}
          >
            <Plus />
            Add workspace
          </DropdownMenuItem>
        ) : null}
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

function RootOverflowMenu({
  project,
  onSetStatus
}: {
  project: Project
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
}): React.JSX.Element {
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
      <DropdownMenuContent align="start" side="right" className="w-56">
        {root ? <WorkspaceStatusMenu workspace={root} onSetStatus={onSetStatus} /> : null}
        <CopyMenuItems branch={null} localPath={localPath} testIdPrefix={`root-${project.id}`} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MultiRootRepoRow({
  project,
  workspace,
  active,
  agents,
  onSelect,
  onOpenAgent
}: {
  project: Project
  workspace: Workspace
  active: boolean
  agents: ChatAgentActivity[]
  onSelect: (workspaceId: number) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
}): React.JSX.Element {
  const name = repositoryDirName(project, workspace)
  const branch = workspace.branch.trim()

  return (
    <li className="relative">
      <WorkspaceHoverCard workspace={workspace} showStatus={false}>
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
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="min-w-0 truncate text-[13px] font-medium leading-4"
                data-testid={`workspace-repo-${workspace.id}`}
              >
                {name}
              </span>
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
                <WorkspacePrPopover workspace={workspace} className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{branch}</span>
              </span>
            ) : null}
            <WorkspaceAgents agents={agents} onOpenAgent={onOpenAgent} />
          </button>
          <WorkspaceOverflowMenu workspace={workspace} allowRemove={false} />
        </SidebarMenuRow>
      </WorkspaceHoverCard>
    </li>
  )
}

function MultiRootWorkspaceTree({
  project,
  activeWorkspaceId,
  activity,
  onSelectWorkspace,
  onOpenAgent,
  onSetStatus
}: {
  project: Project
  activeWorkspaceId: number | null
  activity: Map<number, ChatAgentActivity[]>
  onSelectWorkspace: (workspaceId: number) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
}): React.JSX.Element {
  const [rootOpen, setRootOpen] = useState(true)
  const rootWorkspace = rootWorkspaceOf(project)
  const repos = repositoryWorkspaces(project)
  const rootActive = rootWorkspace != null && rootWorkspace.id === activeWorkspaceId
  const rootAgents = rootWorkspace ? (activity.get(rootWorkspace.id) ?? []) : []
  const rootStatus = workspaceStatus(rootWorkspace?.status)

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
                className="app-no-drag peer/menu-button flex h-auto min-h-7 w-full min-w-0 flex-col items-stretch rounded-md px-2 py-1 pr-14 text-left text-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                data-testid={`project-root-${project.id}`}
                data-workspace-role="root"
                data-workspace-icon="folder-tree"
                data-workspace-status={rootStatus}
                data-workspace-id={rootWorkspace?.id}
                data-active={rootActive ? 'true' : 'false'}
                aria-current={rootActive ? 'location' : undefined}
                disabled={rootWorkspace == null}
                onClick={(event): void => {
                  event.stopPropagation()
                  if (rootWorkspace) onSelectWorkspace(rootWorkspace.id)
                }}
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <FolderTree className="size-4 shrink-0 text-sidebar-accent-foreground" />
                  <WorkspaceRowStatusIcon status={rootStatus} />
                  <span className="min-w-0 flex-1 truncate font-medium">root</span>
                  <span
                    className="shrink-0 text-[10px] text-sidebar-foreground/55 tabular-nums"
                    aria-label={`${repos.length} repositories in root`}
                    data-testid={`root-repo-count-${project.id}`}
                  >
                    {repos.length} {repos.length === 1 ? 'repo' : 'repos'}
                  </span>
                </span>
                <WorkspaceAgents agents={rootAgents} onOpenAgent={onOpenAgent} />
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
              <RootOverflowMenu project={project} onSetStatus={onSetStatus} />
            </SidebarMenuRow>
          </WorkspaceHoverCard>
          <CollapsibleContent>
            {repos.length > 0 ? (
              <ul
                className="ml-6 flex min-w-0 flex-col gap-1 pt-1 pb-0.5"
                aria-label="Repositories in root"
                data-testid={`project-repo-tree-${project.id}`}
              >
                {repos.map((workspace: Workspace) => (
                  <MultiRootRepoRow
                    key={workspace.id}
                    project={project}
                    workspace={workspace}
                    active={workspace.id === activeWorkspaceId}
                    agents={activity.get(workspace.id) ?? []}
                    onSelect={onSelectWorkspace}
                    onOpenAgent={onOpenAgent}
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

function collapsedProjectAgents(
  project: Project,
  open: boolean,
  activity: Map<number, ChatAgentActivity[]>
): ChatAgentActivity[] {
  if (open) return []
  return sortAgentActivity(
    project.workspaces.flatMap((workspace) => activity.get(workspace.id) ?? [])
  )
}

function ProjectItem({
  project,
  activeWorkspaceId,
  activity,
  defaultOpen,
  onSelectWorkspace,
  onAddWorkspace,
  onRemoveProject,
  onRemoveWorkspace,
  onSetStatus,
  onOpenAgent
}: {
  project: Project
  activeWorkspaceId: number | null
  activity: Map<number, ChatAgentActivity[]>
  defaultOpen: boolean
  onSelectWorkspace: (workspaceId: number) => void
  onAddWorkspace: (project: Project) => void
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
  onRemoveWorkspace: (workspaceId: number, deleteFiles: boolean) => void
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const githubLinked = project.github != null
  const multiRoot = isMultiRootProject(project)
  const summary = collapsedProjectAgents(project, open, activity)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <SidebarMenuRow>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              className={cn('app-no-drag sidebar-project-button h-auto!', githubLinked && 'pr-14')}
              data-testid={`project-row-${project.id}`}
              data-project-kind={project.kind}
              data-project-icon={multiRoot ? 'folders' : githubLinked ? 'avatar' : 'folder'}
              title={multiRoot ? `${project.name} (multi-root)` : project.name}
            >
              {multiRoot ? (
                <Folders />
              ) : project.github ? (
                <Avatar className="size-4" aria-hidden="true">
                  <AvatarImage
                    src={`https://avatars.githubusercontent.com/${encodeURIComponent(project.github.owner)}?s=40`}
                    alt=""
                  />
                  <AvatarFallback className="text-[10px] font-medium">
                    {Array.from(project.name.trim())[0]?.toLocaleUpperCase() ?? '?'}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <Folder />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{project.name}</span>
                <WorkspaceAgents
                  agents={summary}
                  testId={`project-agent-status-${project.id}`}
                  className="opacity-60"
                  onOpenAgent={onOpenAgent}
                />
              </div>
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
              activity={activity}
              onSelectWorkspace={onSelectWorkspace}
              onOpenAgent={onOpenAgent}
              onSetStatus={onSetStatus}
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
                          className="app-no-drag flex h-auto! w-full min-w-0 flex-col items-stretch gap-0 py-1.5 pr-8 pl-8"
                          data-testid={`workspace-row-${workspace.id}`}
                          data-workspace-id={workspace.id}
                          aria-current={workspace.id === activeWorkspaceId ? 'location' : undefined}
                          data-workspace-role="branch"
                          data-workspace-icon="branch"
                          data-workspace-status={workspaceStatus(workspace.status)}
                          onClick={(): void => onSelectWorkspace(workspace.id)}
                        >
                          <span className="flex min-w-0 items-center gap-1.5 text-left">
                            <WorkspaceRowStatusIcon status={workspaceStatus(workspace.status)} />
                            <span className="min-w-0 truncate">
                              {workspaceLabel(project, workspace)}
                            </span>
                          </span>
                          <WorkspaceAgents
                            agents={activity.get(workspace.id) ?? []}
                            onOpenAgent={onOpenAgent}
                          />
                        </button>
                      </SidebarMenuSubButton>
                      <WorkspacePrPopover
                        workspace={workspace}
                        className="absolute top-2 left-2 size-4"
                      />
                      <WorkspaceOverflowMenu
                        workspace={workspace}
                        onRemoveWorkspace={onRemoveWorkspace}
                        onSetStatus={onSetStatus}
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
  groupBy,
  onGroupBy,
  onSearchChange,
  onAddProject,
  firstResultId,
  onSelectWorkspace
}: {
  isSettings: boolean
  projectCount: number
  search: string
  groupBy: SidebarGroupBy
  onGroupBy: (groupBy: SidebarGroupBy) => void
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
        <>
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
          <div className="app-no-drag flex items-center gap-2 px-1">
            <span className="text-[11px] text-sidebar-foreground/55">Group</span>
            <div
              role="group"
              aria-label="Group workspaces"
              data-testid="sidebar-group-by"
              data-group-by={groupBy}
              className="flex min-w-0 flex-1 rounded-md bg-sidebar-accent p-0.5"
            >
              {(
                [
                  ['project', 'Projects'],
                  ['status', 'Status']
                ] as const
              ).map(([value, label]) => {
                const selected = groupBy === value
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    data-testid={`sidebar-group-${value}`}
                    data-active={selected ? 'true' : 'false'}
                    className={cn(
                      'min-w-0 flex-1 rounded-[5px] px-2 py-1 text-xs font-medium',
                      selected
                        ? 'bg-sidebar text-sidebar-foreground shadow-sm'
                        : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
                    )}
                    onClick={(): void => onGroupBy(value)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      ) : null}
    </SidebarHeader>
  )
}

function WorkspaceSearchResults({
  results,
  activeWorkspaceId,
  activity,
  onSelectWorkspace,
  onOpenAgent
}: {
  results: WorkspaceSearchResult[]
  activeWorkspaceId: number | null
  activity: Map<number, ChatAgentActivity[]>
  onSelectWorkspace: (workspaceId: number) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
}): React.JSX.Element {
  return (
    <div>
      <p role="status" className="px-2 pt-1 pb-2 text-xs text-sidebar-foreground/60">
        {results.length === 0
          ? 'No matching workspaces'
          : `${results.length} ${results.length === 1 ? 'workspace' : 'workspaces'} found`}
      </p>
      <SidebarMenu>
        {results.map(({ project, workspace, label }) => {
          const carriesStatus = workspaceCarriesStatus(project, workspace)
          const button = (
            <SidebarMenuButton
              className="app-no-drag h-auto min-h-12 items-start py-2"
              isActive={workspace.id === activeWorkspaceId}
              aria-current={workspace.id === activeWorkspaceId ? 'location' : undefined}
              onClick={() => onSelectWorkspace(workspace.id)}
              data-testid={`workspace-search-result-${workspace.id}`}
              data-workspace-status={carriesStatus ? workspaceStatus(workspace.status) : undefined}
            >
              {workspace.kind === 'root' ? (
                <FolderTree className="mt-0.5" />
              ) : (
                <GitBranch className="mt-0.5" />
              )}
              {carriesStatus ? (
                <WorkspaceRowStatusIcon
                  status={workspaceStatus(workspace.status)}
                  className="mt-0.5"
                />
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-xs font-medium">{label}</span>
                <span className="truncate text-[11px] text-sidebar-foreground/60">
                  {project.name}
                </span>
                <WorkspaceAgents
                  agents={activity.get(workspace.id) ?? []}
                  onOpenAgent={onOpenAgent}
                />
              </span>
            </SidebarMenuButton>
          )
          return (
            <SidebarMenuItem key={workspace.id}>
              <WorkspaceHoverCard workspace={workspace} showStatus={carriesStatus}>
                {button}
              </WorkspaceHoverCard>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </div>
  )
}

function workspacesWithStatus(
  projects: Project[],
  status: WorkspaceStatus
): Array<{ project: Project; workspace: Workspace }> {
  const entries: Array<{ project: Project; workspace: Workspace }> = []
  for (const project of projects) {
    for (const workspace of project.workspaces) {
      if (!workspaceCarriesStatus(project, workspace)) continue
      if (workspaceStatus(workspace.status) === status) entries.push({ project, workspace })
    }
  }
  return entries
}

function statusGroupLabel(project: Project, workspace: Workspace): string {
  if (workspace.kind === 'root') return 'root'
  return workspaceLabel(project, workspace)
}

function projectsWithStatus(
  entries: Array<{ project: Project; workspace: Workspace }>
): Array<{ project: Project; workspaces: Workspace[] }> {
  const groups: Array<{ project: Project; workspaces: Workspace[] }> = []
  for (const { project, workspace } of entries) {
    const current = groups[groups.length - 1]
    if (current?.project.id === project.id) current.workspaces.push(workspace)
    else groups.push({ project, workspaces: [workspace] })
  }
  return groups
}

function StatusGroup({
  status,
  entries,
  activeWorkspaceId,
  activity,
  onSelectWorkspace,
  onOpenAgent,
  onAddWorkspace,
  onRemoveWorkspace,
  onSetStatus
}: {
  status: WorkspaceStatus
  entries: Array<{ project: Project; workspace: Workspace }>
  activeWorkspaceId: number | null
  activity: Map<number, ChatAgentActivity[]>
  onSelectWorkspace: (workspaceId: number) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
  onAddWorkspace: (project: Project) => void
  onRemoveWorkspace: (workspaceId: number, deleteFiles: boolean) => void
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
}): React.JSX.Element {
  const presentation = WORKSPACE_STATUS_PRESENTATION[status]
  const containsActive = entries.some((entry) => entry.workspace.id === activeWorkspaceId)
  const startsOpen = entries.length > 0 && (status !== 'done' || containsActive)
  const [open, setOpen] = useState(startsOpen)
  const [trackedCount, setTrackedCount] = useState(entries.length)
  if (entries.length !== trackedCount) {
    setTrackedCount(entries.length)
    if (entries.length > trackedCount) setOpen(true)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className="app-no-drag h-auto font-medium"
            data-testid={`status-group-${status}`}
            data-status={status}
            aria-label={`${presentation.label}, ${entries.length} ${entries.length === 1 ? 'workspace' : 'workspaces'}`}
          >
            <WorkspaceStatusIcon status={status} />
            <span className="min-w-0 flex-1 truncate">{presentation.label}</span>
            <span
              className="text-xs text-sidebar-foreground/55 tabular-nums"
              data-testid={`status-count-${status}`}
            >
              {entries.length}
            </span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {entries.length === 0 ? (
            <p className="px-2 py-1 text-xs text-sidebar-foreground/50">No workspaces</p>
          ) : (
            <SidebarMenuSub>
              {projectsWithStatus(entries).map(({ project, workspaces }) => (
                <li key={project.id} className="min-w-0">
                  <div
                    className="flex min-w-0 items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-[11px] font-semibold text-sidebar-foreground/70"
                    data-testid={`status-project-${status}-${project.id}`}
                  >
                    {isMultiRootProject(project) ? (
                      <Folders className="size-3.5 shrink-0" />
                    ) : (
                      <Folder className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 truncate">{project.name}</span>
                  </div>
                  <ul className="flex min-w-0 flex-col gap-0.5 pl-2">
                    {workspaces.map((workspace) => (
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
                                className="app-no-drag flex h-auto! w-full min-w-0 flex-col items-stretch gap-0 py-1.5 pr-8"
                                data-testid={`workspace-row-${workspace.id}`}
                                data-workspace-id={workspace.id}
                                data-workspace-status={workspaceStatus(workspace.status)}
                                data-workspace-role={workspace.kind === 'root' ? 'root' : 'branch'}
                                aria-current={
                                  workspace.id === activeWorkspaceId ? 'location' : undefined
                                }
                                onClick={(): void => onSelectWorkspace(workspace.id)}
                              >
                                <span className="flex min-w-0 items-center gap-1.5 text-left">
                                  <WorkspaceRowStatusIcon
                                    status={workspaceStatus(workspace.status)}
                                  />
                                  <span className="min-w-0 flex-1 truncate">
                                    {statusGroupLabel(project, workspace)}
                                  </span>
                                </span>
                                <WorkspaceAgents
                                  agents={activity.get(workspace.id) ?? []}
                                  onOpenAgent={onOpenAgent}
                                />
                              </button>
                            </SidebarMenuSubButton>
                            <WorkspaceOverflowMenu
                              workspace={workspace}
                              allowRemove={workspace.kind === 'worktree'}
                              project={project}
                              onAddWorkspace={project.github ? onAddWorkspace : undefined}
                              onRemoveWorkspace={onRemoveWorkspace}
                              onSetStatus={onSetStatus}
                            />
                          </SidebarMenuRow>
                        </WorkspaceHoverCard>
                      </SidebarMenuSubItem>
                    ))}
                  </ul>
                </li>
              ))}
            </SidebarMenuSub>
          )}
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function StatusGroups({
  projects,
  activeWorkspaceId,
  activity,
  onSelectWorkspace,
  onOpenAgent,
  onAddWorkspace,
  onRemoveWorkspace,
  onSetStatus
}: {
  projects: Project[]
  activeWorkspaceId: number | null
  activity: Map<number, ChatAgentActivity[]>
  onSelectWorkspace: (workspaceId: number) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
  onAddWorkspace: (project: Project) => void
  onRemoveWorkspace: (workspaceId: number, deleteFiles: boolean) => void
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
}): React.JSX.Element {
  return (
    <SidebarMenu className="gap-1" data-testid="sidebar-status-groups">
      {WORKSPACE_STATUSES.map((status) => (
        <StatusGroup
          key={status}
          status={status}
          entries={workspacesWithStatus(projects, status)}
          activeWorkspaceId={activeWorkspaceId}
          activity={activity}
          onSelectWorkspace={onSelectWorkspace}
          onOpenAgent={onOpenAgent}
          onAddWorkspace={onAddWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
          onSetStatus={onSetStatus}
        />
      ))}
    </SidebarMenu>
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
  onSetWorkspaceStatus,
  sidebarGroupBy,
  onSidebarGroupBy,
  onSelectSettingsSection,
  onOpenSettings,
  onBack
}: AppSidebarProps): React.JSX.Element {
  const isSettings = mode === 'settings'
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState(sidebarGroupBy)
  const [trackedGroup, setTrackedGroup] = useState(sidebarGroupBy)
  if (sidebarGroupBy !== trackedGroup) {
    setTrackedGroup(sidebarGroupBy)
    setGroupBy(sidebarGroupBy)
  }
  const query = search.trim().toLowerCase()
  const results = searchWorkspaces(projects, query)
  const activity = useAgentActivity()
  const openAgent = (agent: ChatAgentActivity): void => {
    onSelectWorkspace(agent.workspaceId)
    if (agent.paneId == null) return
    void window.cerebro
      .layoutCommand({
        target: 'pane',
        action: 'focus',
        workspaceId: agent.workspaceId,
        paneId: agent.paneId
      })
      .then((reply) => acceptLayout(reply.state))
      .catch(() => {})
  }

  return (
    <Sidebar
      collapsible={isSettings ? 'none' : 'offcanvas'}
      className={cn('cerebro-sidebar', isSettings && 'border-r border-sidebar-border')}
    >
      <NavigationHeader
        isSettings={isSettings}
        projectCount={projects.length}
        search={search}
        groupBy={groupBy}
        onGroupBy={(next): void => {
          if (next === groupBy) return
          const previous = groupBy
          setGroupBy(next)
          void Promise.resolve(onSidebarGroupBy(next)).catch(() => setGroupBy(previous))
        }}
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
                  activity={activity}
                  onSelectWorkspace={onSelectWorkspace}
                  onOpenAgent={openAgent}
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
              ) : groupBy === 'status' ? (
                <div className={query ? 'hidden' : undefined}>
                  <StatusGroups
                    projects={projects}
                    activeWorkspaceId={activeWorkspaceId}
                    activity={activity}
                    onSelectWorkspace={onSelectWorkspace}
                    onOpenAgent={openAgent}
                    onAddWorkspace={onAddWorkspace}
                    onRemoveWorkspace={onRemoveWorkspace}
                    onSetStatus={onSetWorkspaceStatus}
                  />
                </div>
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
                        activity={activity}
                        defaultOpen={containsActive || projects.length === 1}
                        onSelectWorkspace={onSelectWorkspace}
                        onOpenAgent={openAgent}
                        onAddWorkspace={onAddWorkspace}
                        onRemoveProject={onRemoveProject}
                        onRemoveWorkspace={onRemoveWorkspace}
                        onSetStatus={onSetWorkspaceStatus}
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
