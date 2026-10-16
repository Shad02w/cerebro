import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentProps
} from 'react'
import { useQuery } from '@tanstack/react-query'
import '@/assets/sidebar.css'
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Folder,
  FolderPlus,
  GitBranch,
  History,
  MoreHorizontal,
  Pencil,
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
import { SessionSearchDialog, type SessionSearchRequest } from '@/components/session-search-dialog'
import { WorkspaceSessionList } from '@/components/workspace-sessions'
import { useKeybindHandler } from '@/keybinds'
import { sortAgentActivity, useAgentActivity } from '@/lib/agent-activity'
import { openAgentSession } from '@/lib/open-agent-session'
import { layoutOptions } from '@/lib/query-client'
import { SETTINGS_SECTIONS } from '@/lib/settings-sections'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { RenameWorkspaceDialog } from '@/components/rename-workspace-dialog'
import { WorkspaceHoverCard } from '@/components/workspace-hover-card'
import { WorkspacePrPopover } from '@/components/workspace-pr-popover'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { WorkspaceStatusIcon, WorkspaceStatusMenu } from '@/components/workspace-status'
import {
  WORKSPACE_STATUS_PRESENTATION,
  isPlainDirectoryProject,
  projectsBesidesNestedRepos,
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

/** Project rows read as section labels. Workspace and worktree rows stay items. */
const projectSectionLabelClass = cn(
  'sidebar-project-button h-auto! bg-transparent text-xs font-medium text-sidebar-foreground/60 shadow-none',
  'hover:bg-transparent hover:text-sidebar-foreground/60 hover:shadow-none',
  'active:bg-transparent active:text-sidebar-foreground/60',
  'data-popup-open:bg-transparent data-popup-open:hover:bg-transparent data-popup-open:hover:text-sidebar-foreground/60',
  '[&>svg]:text-sidebar-foreground/60'
)

/** About 10px above a project row, separating it from the previous group's last workspace. */
const projectGroupSpacingClass = 'not-first:mt-2.5'

/** Workspace rows inside Todo sit a step below the contrast of the other status groups. */
const todoWorkspaceMuteClass = 'text-sidebar-foreground/55'

type AppSidebarProps = {
  mode: 'projects' | 'settings'
  projects: Project[]
  activeWorkspaceId: number | null
  settingsSection: SettingsSectionId
  onSelectWorkspace: (workspaceId: number) => void
  onAddProject: () => void
  onAddWorkspace: (project: Project) => void
  onRenameWorkspace: (workspaceId: number, displayName: string | null) => Promise<void>
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
  onRemoveWorkspace: (workspaceId: number, deleteFiles: boolean) => void
  onSetWorkspaceStatus: (workspaceId: number, status: WorkspaceStatus) => void
  sidebarGroupBy: SidebarGroupBy
  onSidebarGroupBy: (groupBy: SidebarGroupBy) => Promise<void> | void
  onSelectSettingsSection: (section: SettingsSectionId) => void
  onOpenSettings: () => void
  onBack: () => void
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // Clipboard can be unavailable in locked-down environments.
  }
}

const OpenSessionSearchContext = createContext<{
  open: (workspaceId: number) => void
  historyWorkspaceId: number | null
}>({ open: () => {}, historyWorkspaceId: null })

function WorkspaceSessionHistory({ workspaceId }: { workspaceId: number }): React.JSX.Element {
  const { open, historyWorkspaceId } = useContext(OpenSessionSearchContext)
  return (
    <PlusActionTooltip label="Session history">
      <SidebarMenuAction
        showOnHover
        tabIndex={-1}
        className="app-no-drag"
        data-testid={`workspace-search-sessions-${workspaceId}`}
        data-popup-open={historyWorkspaceId === workspaceId ? '' : undefined}
        aria-label="Session history"
        onPointerDown={(event): void => event.stopPropagation()}
        onClick={(event): void => {
          event.preventDefault()
          event.stopPropagation()
          open(workspaceId)
        }}
      >
        <History className="size-3.5" />
        <span className="sr-only">Session history</span>
      </SidebarMenuAction>
    </PlusActionTooltip>
  )
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
      <TooltipTrigger render={children} />
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
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
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
          />
        }
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
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        sideOffset={4}
        collisionAvoidance={{ side: 'none', align: 'none', fallbackAxisSide: 'none' }}
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

function defaultWorkspaceLabel(project: Project, workspace: Workspace): string {
  if (workspace.kind === 'root') return 'root'
  if (!workspace.branch || workspace.branch === '.') return project.name
  return workspace.branch
}

function workspaceRowLabel(project: Project, workspace: Workspace): string {
  const custom = workspace.displayName?.trim()
  return custom || defaultWorkspaceLabel(project, workspace)
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
      <TooltipTrigger render={<span className="flex w-full" data-testid={testId} />}>
        <DropdownMenuItem variant="destructive" disabled className="w-full">
          <Trash2 />
          {label}
        </DropdownMenuItem>
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
  onRemoveProject,
  menuTestId
}: {
  project: Project
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
  menuTestId?: string
}): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction
            className="app-no-drag"
            showOnHover
            data-testid={menuTestId ?? `project-menu-${project.id}`}
            onClick={(event): void => event.stopPropagation()}
            onPointerDown={(event): void => event.stopPropagation()}
          />
        }
      >
        <MoreHorizontal />
        <span className="sr-only">Project actions</span>
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

function RenameMenuItem({
  workspaceId,
  onRename
}: {
  workspaceId: number
  onRename: () => void
}): React.JSX.Element {
  return (
    <DropdownMenuItem
      data-testid={`workspace-rename-${workspaceId}`}
      onClick={(event): void => {
        event.stopPropagation()
        onRename()
      }}
    >
      <Pencil />
      Rename
    </DropdownMenuItem>
  )
}

function WorkspaceOverflowMenu({
  workspace,
  allowRemove = true,
  project,
  onAddWorkspace,
  onRename,
  onRemoveWorkspace,
  onSetStatus
}: {
  workspace: Workspace
  allowRemove?: boolean
  project?: Project
  onAddWorkspace?: (project: Project) => void
  onRename: () => void
  onRemoveWorkspace?: (workspaceId: number, deleteFiles: boolean) => void
  onSetStatus?: (workspaceId: number, status: WorkspaceStatus) => void
}): React.JSX.Element {
  const isDefault = workspace.kind === 'default'

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction
            className="app-no-drag workspace-row-menu"
            showOnHover
            data-testid={`workspace-menu-${workspace.id}`}
            onClick={(event): void => event.stopPropagation()}
            onPointerDown={(event): void => event.stopPropagation()}
          />
        }
      >
        <MoreHorizontal />
        <span className="sr-only">Workspace actions</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-56">
        <RenameMenuItem workspaceId={workspace.id} onRename={onRename} />
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
        <DropdownMenuSeparator />
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

/** More / add buttons for a row. Overlay pins them to the name line. */
function RowActions({
  overlay = false,
  className,
  children
}: {
  overlay?: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('sidebar-row-actions', className)} data-overlay={overlay ? '' : undefined}>
      {children}
    </div>
  )
}

function WorkspaceLine({
  icon,
  className,
  children,
  ...props
}: ComponentProps<'span'> & { icon: React.ReactNode }): React.JSX.Element {
  return (
    <span className={className} data-row-line="" data-workspace-label="" {...props}>
      <span data-row-icon="">{icon}</span>
      <span data-row-label="">{children}</span>
    </span>
  )
}

/** Git branch mark in the name line. A pull request keeps a spacer; the control sits on that box, outside the row button. */
function BranchIconSlot({
  workspace,
  muted = false
}: {
  workspace: Workspace
  muted?: boolean
}): React.JSX.Element {
  if (workspace.pullRequest) return <span aria-hidden data-branch-icon-spacer="" />
  return <WorkspacePrPopover workspace={workspace} muted={muted} className="size-full" />
}

function BranchIconOverlay({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  if (!workspace.pullRequest) return null
  return (
    <span className="workspace-pr-icon-overlay">
      <WorkspacePrPopover workspace={workspace} className="pointer-events-auto size-4" />
    </span>
  )
}

function workspaceBranchButtonClass(singleLine: boolean): string {
  return cn(
    'app-no-drag flex w-full min-w-0 translate-x-0 gap-0 px-2 pr-14 py-0',
    singleLine ? 'h-8! items-center' : 'h-auto! flex-col items-stretch'
  )
}

function ProjectIcon({ project }: { project: Project }): React.JSX.Element {
  if (!project.github) return <Folder />
  return (
    <Avatar className="size-full" aria-hidden="true">
      <AvatarImage
        src={`https://avatars.githubusercontent.com/${encodeURIComponent(project.github.owner)}?s=40`}
        alt=""
      />
      <AvatarFallback className="text-[10px] font-medium">
        {Array.from(project.name.trim())[0]?.toLocaleUpperCase() ?? '?'}
      </AvatarFallback>
    </Avatar>
  )
}

function collapsedProjectAgents(
  workspaces: Workspace[],
  open: boolean,
  activity: Map<number, ChatAgentActivity[]>
): ChatAgentActivity[] {
  if (open) return []
  return sortAgentActivity(workspaces.flatMap((workspace) => activity.get(workspace.id) ?? []))
}

function ProjectItem({
  project,
  activeWorkspaceId,
  activity,
  defaultOpen,
  onSelectWorkspace,
  onAddWorkspace,
  onRenameWorkspace,
  onRemoveProject,
  onRemoveWorkspace,
  onSetStatus,
  onOpenAgent,
  workspaces,
  rowTestId,
  menuTestId,
  addTestId,
  muteWorkspaceRows = false
}: {
  project: Project
  activeWorkspaceId: number | null
  activity: Map<number, ChatAgentActivity[]>
  defaultOpen: boolean
  onSelectWorkspace: (workspaceId: number) => void
  onAddWorkspace: (project: Project) => void
  onRenameWorkspace: (workspace: Workspace) => void
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
  onRemoveWorkspace: (workspaceId: number, deleteFiles: boolean) => void
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
  /** Status groups list only the workspaces in that status. */
  workspaces?: Workspace[]
  rowTestId?: string
  menuTestId?: string
  addTestId?: string
  muteWorkspaceRows?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const githubLinked = project.github != null
  const listed = workspaces ?? project.workspaces
  const summary = collapsedProjectAgents(listed, open, activity)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn('group/collapsible', projectGroupSpacingClass)}
    >
      <SidebarMenuItem>
        <SidebarMenuRow>
          <CollapsibleTrigger
            render={
              <SidebarMenuButton
                className={cn(
                  'app-no-drag flex-col items-stretch gap-0 py-0',
                  projectSectionLabelClass,
                  githubLinked && 'pr-14'
                )}
                data-testid={rowTestId ?? `project-row-${project.id}`}
                data-project-kind={project.kind}
                data-project-icon={githubLinked ? 'avatar' : 'folder'}
                title={project.name}
              />
            }
          >
            <span data-row-line="">
              <span data-row-icon="">
                <ProjectIcon project={project} />
              </span>
              <span className="font-medium" data-row-label="">
                {project.name}
              </span>
            </span>
            <WorkspaceAgents
              agents={summary}
              testId={`project-agent-status-${project.id}`}
              className="-mt-1 mb-1 opacity-60"
              onOpenAgent={onOpenAgent}
            />
          </CollapsibleTrigger>
          <RowActions overlay>
            <ProjectOverflowMenu
              project={project}
              onRemoveProject={onRemoveProject}
              menuTestId={menuTestId}
            />
            {githubLinked ? (
              <PlusActionTooltip label="Add workspace">
                <SidebarMenuAction
                  className="app-no-drag"
                  showOnHover
                  data-testid={addTestId ?? `project-add-workspace-${project.id}`}
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
          </RowActions>
        </SidebarMenuRow>
        <CollapsibleContent>
          {listed.length > 0 ? (
            <SidebarMenuSub>
              {listed.map((workspace: Workspace) => {
                const agents = activity.get(workspace.id) ?? []
                const muted = muteWorkspaceRows && workspace.id !== activeWorkspaceId
                return (
                  <SidebarMenuSubItem key={workspace.id}>
                    <WorkspaceHoverCard workspace={workspace}>
                      <SidebarMenuRow data-workspace-id={workspace.id}>
                        <SidebarMenuSubButton
                          size="sm"
                          isActive={workspace.id === activeWorkspaceId}
                          render={
                            <button
                              type="button"
                              className={cn(
                                workspaceBranchButtonClass(true),
                                muted && todoWorkspaceMuteClass
                              )}
                              data-testid={`workspace-row-${workspace.id}`}
                              data-workspace-id={workspace.id}
                              data-todo-muted={muted ? 'true' : undefined}
                              aria-current={
                                workspace.id === activeWorkspaceId ? 'location' : undefined
                              }
                              data-workspace-role="branch"
                              data-workspace-icon="branch"
                              data-workspace-status={workspaceStatus(workspace.status)}
                              onClick={(): void => onSelectWorkspace(workspace.id)}
                            />
                          }
                        >
                          <WorkspaceLine
                            icon={<BranchIconSlot workspace={workspace} muted={muted} />}
                          >
                            {workspaceRowLabel(project, workspace)}
                          </WorkspaceLine>
                        </SidebarMenuSubButton>
                        <BranchIconOverlay workspace={workspace} />
                        <RowActions overlay>
                          <WorkspaceSessionHistory workspaceId={workspace.id} />
                          <WorkspaceOverflowMenu
                            workspace={workspace}
                            onRename={(): void => onRenameWorkspace(workspace)}
                            onRemoveWorkspace={onRemoveWorkspace}
                            onSetStatus={onSetStatus}
                          />
                        </RowActions>
                        <WorkspaceSessionList
                          agents={agents}
                          muted={muted}
                          onOpenAgent={onOpenAgent}
                        />
                      </SidebarMenuRow>
                    </WorkspaceHoverCard>
                  </SidebarMenuSubItem>
                )
              })}
            </SidebarMenuSub>
          ) : null}
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function PlainDirectoryRow({
  project,
  activeWorkspaceId,
  activity,
  onSelectWorkspace,
  onOpenAgent,
  onRenameWorkspace,
  onRemoveProject,
  onSetStatus,
  muted = false
}: {
  project: Project
  activeWorkspaceId: number | null
  activity: Map<number, ChatAgentActivity[]>
  onSelectWorkspace: (workspaceId: number) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
  onRenameWorkspace: (workspace: Workspace) => void
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
  muted?: boolean
}): React.JSX.Element | null {
  const workspace = project.workspaces[0]
  if (!workspace) return null
  const active = workspace.id === activeWorkspaceId
  const agents = activity.get(workspace.id) ?? []

  return (
    <SidebarMenuItem className={projectGroupSpacingClass}>
      <WorkspaceHoverCard workspace={workspace}>
        <SidebarMenuRow data-workspace-id={workspace.id}>
          <SidebarMenuButton
            isActive={active}
            className={cn(
              'app-no-drag h-8! items-center gap-0 px-2 py-0 pr-14 text-xs font-medium',
              muted && !active && todoWorkspaceMuteClass
            )}
            render={
              <button
                type="button"
                data-testid={`workspace-row-${workspace.id}`}
                data-workspace-id={workspace.id}
                data-workspace-role="directory"
                data-workspace-icon="folder"
                data-project-kind="directory"
                data-todo-muted={muted && !active ? 'true' : undefined}
                data-workspace-status={workspaceStatus(workspace.status)}
                aria-current={active ? 'location' : undefined}
                onClick={(): void => onSelectWorkspace(workspace.id)}
              />
            }
          >
            <span data-row-line="">
              <span data-row-icon="">
                <Folder />
              </span>
              <span className="truncate font-medium" data-row-label="">
                {workspaceRowLabel(project, workspace)}
              </span>
              {(project.nestedRepos?.length ?? 0) > 1 ? (
                <span
                  className="shrink-0 rounded-md bg-[color-mix(in_oklch,var(--sidebar-selected)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[var(--sidebar-selected)] uppercase"
                  data-testid={`workspace-multi-root-${workspace.id}`}
                >
                  multi-root
                </span>
              ) : null}
            </span>
          </SidebarMenuButton>
          <RowActions overlay>
            <WorkspaceSessionHistory workspaceId={workspace.id} />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuAction
                    className="app-no-drag workspace-row-menu"
                    showOnHover
                    data-testid={`workspace-menu-${workspace.id}`}
                    onClick={(event): void => event.stopPropagation()}
                    onPointerDown={(event): void => event.stopPropagation()}
                  />
                }
              >
                <MoreHorizontal />
                <span className="sr-only">Workspace actions</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="w-56">
                <RenameMenuItem
                  workspaceId={workspace.id}
                  onRename={(): void => onRenameWorkspace(workspace)}
                />
                <WorkspaceStatusMenu workspace={workspace} onSetStatus={onSetStatus} />
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid={`workspace-${workspace.id}-copy-path`}
                  onClick={(event): void => {
                    event.stopPropagation()
                    void copyToClipboard(workspace.localPath)
                  }}
                >
                  <Copy />
                  Copy path
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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
          </RowActions>
          <WorkspaceSessionList
            agents={agents}
            muted={muted && !active}
            onOpenAgent={onOpenAgent}
          />
          {(project.nestedRepos?.length ?? 0) > 0 ? (
            <ul
              className="flex min-w-0 flex-col gap-1 px-2 pt-1 pb-1.5"
              aria-label={`Repositories in ${workspaceRowLabel(project, workspace)}`}
              data-nested-repos=""
              data-testid={`workspace-nested-repos-${workspace.id}`}
            >
              {project.nestedRepos?.map((repo) => (
                <li key={repo.localPath} data-testid={`workspace-nested-repo-${repo.name}`}>
                  <span className="block truncate text-[13px] font-medium">{repo.name}</span>
                  {repo.branch ? (
                    <span
                      className="text-[11px] leading-4 text-sidebar-foreground/65"
                      data-branch-line=""
                      data-testid={`workspace-nested-branch-${repo.name}`}
                    >
                      <span
                        aria-hidden
                        className="h-2.5 w-2 shrink-0 rounded-bl-[3px] border-b border-l border-current opacity-40"
                      />
                      <GitBranch className="size-3 shrink-0" />
                      <span className="min-w-0 truncate">{repo.branch}</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </SidebarMenuRow>
      </WorkspaceHoverCard>
    </SidebarMenuItem>
  )
}

type WorkspaceSearchResult = { project: Project; workspace: Workspace; label: string }

function searchWorkspaces(projects: Project[], query: string): WorkspaceSearchResult[] {
  if (!query) return []
  return projects.flatMap((project) =>
    project.workspaces.flatMap((workspace) => {
      const visible = workspaceRowLabel(project, workspace)
      const haystack = [
        project.name,
        visible,
        workspace.displayName,
        defaultWorkspaceLabel(project, workspace),
        workspace.kind === 'root' ? null : workspace.branch
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query) ? [{ project, workspace, label: visible }] : []
    })
  )
}

function NavigationHeader({
  isSettings,
  search,
  groupBy,
  onGroupBy,
  onSearchChange,
  onAddProject,
  firstResultId,
  onSelectWorkspace
}: {
  isSettings: boolean
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
            <DropdownMenu>
              <PlusActionTooltip label="Group by">
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="app-no-drag sidebar-header-action sidebar-header-quiet"
                      aria-label="Group by"
                      data-testid="sidebar-group-by"
                      data-group-by={groupBy}
                    />
                  }
                >
                  <Settings className="size-4" />
                </DropdownMenuTrigger>
              </PlusActionTooltip>
              <DropdownMenuContent align="end" className="min-w-36" finalFocus={false}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                    Group by
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={groupBy}
                    onValueChange={(value): void => {
                      if (value === 'project' || value === 'status') onGroupBy(value)
                    }}
                  >
                    <DropdownMenuRadioItem
                      value="project"
                      closeOnClick
                      data-testid="sidebar-group-project"
                    >
                      Project
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="status"
                      closeOnClick
                      data-testid="sidebar-group-status"
                    >
                      Status
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <PlusActionTooltip label="Add project">
              <button
                type="button"
                className="app-no-drag sidebar-header-action sidebar-header-quiet -mr-1"
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
          return (
            <SidebarMenuItem key={workspace.id}>
              <SidebarMenuRow data-workspace-id={workspace.id}>
                <WorkspaceHoverCard workspace={workspace} showStatus={carriesStatus}>
                  <SidebarMenuButton
                    className="app-no-drag h-auto min-h-12 items-start py-2 pr-8"
                    isActive={workspace.id === activeWorkspaceId}
                    aria-current={workspace.id === activeWorkspaceId ? 'location' : undefined}
                    onClick={() => onSelectWorkspace(workspace.id)}
                    data-testid={`workspace-search-result-${workspace.id}`}
                    data-workspace-status={
                      carriesStatus ? workspaceStatus(workspace.status) : undefined
                    }
                  >
                    {workspace.branch && workspace.branch !== '.' ? (
                      <GitBranch className="mt-0.5" />
                    ) : (
                      <Folder className="mt-0.5" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-xs font-medium">{label}</span>
                      <span className="truncate text-[11px] text-sidebar-foreground/60">
                        {project.name}
                      </span>
                    </span>
                  </SidebarMenuButton>
                </WorkspaceHoverCard>
                <RowActions overlay>
                  <WorkspaceSessionHistory workspaceId={workspace.id} />
                </RowActions>
                <WorkspaceSessionList
                  agents={activity.get(workspace.id) ?? []}
                  onOpenAgent={onOpenAgent}
                />
              </SidebarMenuRow>
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
  onRemoveProject,
  onRemoveWorkspace,
  onRenameWorkspace,
  onSetStatus,
  open: controlledOpen,
  onOpenChange
}: {
  status: WorkspaceStatus
  entries: Array<{ project: Project; workspace: Workspace }>
  activeWorkspaceId: number | null
  activity: Map<number, ChatAgentActivity[]>
  onSelectWorkspace: (workspaceId: number) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
  onAddWorkspace: (project: Project) => void
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
  onRemoveWorkspace: (workspaceId: number, deleteFiles: boolean) => void
  onRenameWorkspace: (project: Project, workspace: Workspace) => void
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
  /** Done is controlled so a collapsed header can sit outside the scrolling list. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const presentation = WORKSPACE_STATUS_PRESENTATION[status]
  const startsOpen = entries.length > 0
  const [uncontrolledOpen, setUncontrolledOpen] = useState(startsOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean): void => {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const [trackedCount, setTrackedCount] = useState(entries.length)
  if (entries.length !== trackedCount) {
    setTrackedCount(entries.length)
    if (entries.length > trackedCount && !open) setOpen(true)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              className={cn(
                'group/status-header sidebar-status-header app-no-drag h-8 bg-transparent pr-2! text-[11px] font-semibold tracking-wider uppercase shadow-none hover:bg-transparent hover:shadow-none active:bg-transparent',
                presentation.headerClassName
              )}
              data-testid={`status-group-${status}`}
              data-status={status}
              aria-label={`${presentation.label}, ${entries.length} ${entries.length === 1 ? 'workspace' : 'workspaces'}`}
            />
          }
        >
          <WorkspaceStatusIcon status={status} />
          <span className="min-w-0 flex-1 truncate">{presentation.label}</span>
          <ChevronRight
            aria-hidden
            data-testid={`status-chevron-${status}`}
            className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-focus-visible/status-header:opacity-70 group-hover/status-header:opacity-70 group-data-panel-open/status-header:rotate-90"
          />
          <span
            className={cn(
              'min-w-5 rounded-full px-1.5 text-center text-[11px] font-medium tracking-normal tabular-nums',
              presentation.badgeClassName
            )}
            data-testid={`status-count-${status}`}
          >
            {entries.length}
          </span>
        </CollapsibleTrigger>
      </SidebarMenuItem>
      <CollapsibleContent>
        {entries.length === 0 ? (
          <p className="px-2 py-1 text-xs text-sidebar-foreground/50">No workspaces</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-0 pt-1" data-sidebar="status-projects">
            {projectsWithStatus(entries).map(({ project, workspaces }) =>
              isPlainDirectoryProject(project) ? (
                <PlainDirectoryRow
                  key={project.id}
                  project={project}
                  activeWorkspaceId={activeWorkspaceId}
                  activity={activity}
                  onSelectWorkspace={onSelectWorkspace}
                  onOpenAgent={onOpenAgent}
                  onRenameWorkspace={(workspace): void => onRenameWorkspace(project, workspace)}
                  onRemoveProject={onRemoveProject}
                  onSetStatus={onSetStatus}
                  muted={status === 'todo'}
                />
              ) : (
                <ProjectItem
                  key={project.id}
                  project={project}
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  activity={activity}
                  defaultOpen
                  onSelectWorkspace={onSelectWorkspace}
                  onOpenAgent={onOpenAgent}
                  onAddWorkspace={onAddWorkspace}
                  onRenameWorkspace={(workspace): void => onRenameWorkspace(project, workspace)}
                  onRemoveProject={onRemoveProject}
                  onRemoveWorkspace={onRemoveWorkspace}
                  onSetStatus={onSetStatus}
                  rowTestId={`status-project-${status}-${project.id}`}
                  menuTestId={`status-project-menu-${status}-${project.id}`}
                  addTestId={`status-project-add-${status}-${project.id}`}
                  muteWorkspaceRows={status === 'todo'}
                />
              )
            )}
          </div>
        )}
      </CollapsibleContent>
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
  onRemoveProject,
  onRemoveWorkspace,
  onRenameWorkspace,
  onSetStatus
}: {
  projects: Project[]
  activeWorkspaceId: number | null
  activity: Map<number, ChatAgentActivity[]>
  onSelectWorkspace: (workspaceId: number) => void
  onOpenAgent: (agent: ChatAgentActivity) => void
  onAddWorkspace: (project: Project) => void
  onRemoveProject: (projectId: number, deleteFiles: boolean) => void
  onRemoveWorkspace: (workspaceId: number, deleteFiles: boolean) => void
  onRenameWorkspace: (project: Project, workspace: Workspace) => void
  onSetStatus: (workspaceId: number, status: WorkspaceStatus) => void
}): React.JSX.Element {
  const doneEntries = workspacesWithStatus(projects, 'done')
  // Done opens with the other groups when it has workspaces, including while Todo is selected.
  const [doneOpen, setDoneOpen] = useState(() => doneEntries.length > 0)
  const activeInDone = doneEntries.some((entry) => entry.workspace.id === activeWorkspaceId)
  const [trackedActiveInDone, setTrackedActiveInDone] = useState(activeInDone)
  if (activeInDone !== trackedActiveInDone) {
    setTrackedActiveInDone(activeInDone)
    if (activeInDone) setDoneOpen(true)
  }
  const group = (status: WorkspaceStatus): React.JSX.Element => (
    <StatusGroup
      key={status}
      status={status}
      entries={status === 'done' ? doneEntries : workspacesWithStatus(projects, status)}
      activeWorkspaceId={activeWorkspaceId}
      activity={activity}
      onSelectWorkspace={onSelectWorkspace}
      onOpenAgent={onOpenAgent}
      onAddWorkspace={onAddWorkspace}
      onRemoveProject={onRemoveProject}
      onRemoveWorkspace={onRemoveWorkspace}
      onRenameWorkspace={onRenameWorkspace}
      onSetStatus={onSetStatus}
      open={status === 'done' ? doneOpen : undefined}
      onOpenChange={status === 'done' ? setDoneOpen : undefined}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="sidebar-status-scroll">
        <SidebarMenu className="gap-1" data-testid="sidebar-status-groups">
          {WORKSPACE_STATUSES.map((status) =>
            status === 'done' && !doneOpen ? null : group(status)
          )}
        </SidebarMenu>
      </div>
      {doneOpen ? null : (
        <div
          className="shrink-0 bg-sidebar"
          data-status-pinned="done"
          data-testid="status-done-pinned"
        >
          <SidebarMenu className="gap-1">{group('done')}</SidebarMenu>
        </div>
      )}
    </div>
  )
}

type RenameTarget = {
  workspaceId: number
  defaultName: string
  currentName: string
}

export function AppSidebar({
  mode,
  projects,
  activeWorkspaceId,
  settingsSection,
  onSelectWorkspace,
  onAddProject,
  onAddWorkspace,
  onRenameWorkspace,
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
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const openRename = (project: Project, workspace: Workspace): void => {
    const defaultName = defaultWorkspaceLabel(project, workspace)
    setRenameTarget({
      workspaceId: workspace.id,
      defaultName,
      currentName: workspace.displayName?.trim() || defaultName
    })
  }
  const query = search.trim().toLowerCase()
  const sidebarProjects = projectsBesidesNestedRepos(projects)
  const results = searchWorkspaces(sidebarProjects, query)
  const activity = useAgentActivity()
  const [sessionSearch, setSessionSearch] = useState<SessionSearchRequest | null>(null)
  useKeybindHandler('searchSessions', () => {
    if (isSettings) return false
    setSessionSearch((current) => (current?.mode === 'palette' ? null : { mode: 'palette' }))
    return true
  })
  const openAgent = (agent: ChatAgentActivity): void => {
    void openAgentSession(agent, onSelectWorkspace).catch(() => {})
  }
  const openWorkspaceSearch = useCallback(
    (workspaceId: number): void => {
      setSessionSearch({ mode: 'workspace', workspaceId })
    },
    [setSessionSearch]
  )
  const statusLayout = !isSettings && !query && sidebarProjects.length > 0 && groupBy === 'status'

  return (
    <OpenSessionSearchContext.Provider
      value={{
        open: openWorkspaceSearch,
        historyWorkspaceId: sessionSearch?.mode === 'workspace' ? sessionSearch.workspaceId : null
      }}
    >
      <>
        <Sidebar
          collapsible={isSettings ? 'none' : 'offcanvas'}
          className={cn('cerebro-sidebar', isSettings && 'border-r border-sidebar-border')}
        >
          <NavigationHeader
            isSettings={isSettings}
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
          <SidebarContent className={statusLayout ? 'overflow-hidden' : undefined}>
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
              <SidebarGroup className={statusLayout ? 'min-h-0 flex-1 overflow-hidden' : undefined}>
                <SidebarGroupContent
                  className={statusLayout ? 'flex min-h-0 flex-1 flex-col' : undefined}
                >
                  {query ? (
                    <WorkspaceSearchResults
                      results={results}
                      activeWorkspaceId={activeWorkspaceId}
                      activity={activity}
                      onSelectWorkspace={onSelectWorkspace}
                      onOpenAgent={openAgent}
                    />
                  ) : null}
                  {sidebarProjects.length === 0 ? (
                    <p
                      className={cn(
                        'px-2 py-1.5 text-xs text-sidebar-foreground/60',
                        query && 'hidden'
                      )}
                    >
                      No projects yet. Use + to clone a repository or open a folder.
                    </p>
                  ) : groupBy === 'status' ? (
                    <div className={cn('flex min-h-0 flex-1 flex-col', query && 'hidden')}>
                      <StatusGroups
                        projects={sidebarProjects}
                        activeWorkspaceId={activeWorkspaceId}
                        activity={activity}
                        onSelectWorkspace={onSelectWorkspace}
                        onOpenAgent={openAgent}
                        onAddWorkspace={onAddWorkspace}
                        onRemoveProject={onRemoveProject}
                        onRemoveWorkspace={onRemoveWorkspace}
                        onRenameWorkspace={openRename}
                        onSetStatus={onSetWorkspaceStatus}
                      />
                    </div>
                  ) : (
                    <SidebarMenu className={query ? 'hidden' : 'gap-0'}>
                      {sidebarProjects.map((project) => {
                        if (isPlainDirectoryProject(project)) {
                          return (
                            <PlainDirectoryRow
                              key={project.id}
                              project={project}
                              activeWorkspaceId={activeWorkspaceId}
                              activity={activity}
                              onSelectWorkspace={onSelectWorkspace}
                              onOpenAgent={openAgent}
                              onRenameWorkspace={(workspace): void =>
                                openRename(project, workspace)
                              }
                              onRemoveProject={onRemoveProject}
                              onSetStatus={onSetWorkspaceStatus}
                            />
                          )
                        }
                        const containsActive = project.workspaces.some(
                          (workspace) => workspace.id === activeWorkspaceId
                        )
                        return (
                          <ProjectItem
                            key={project.id}
                            project={project}
                            activeWorkspaceId={activeWorkspaceId}
                            activity={activity}
                            defaultOpen={containsActive || sidebarProjects.length === 1}
                            onSelectWorkspace={onSelectWorkspace}
                            onOpenAgent={openAgent}
                            onAddWorkspace={onAddWorkspace}
                            onRenameWorkspace={(workspace): void => openRename(project, workspace)}
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
                  <SidebarMenuButton className="app-no-drag" size="sm" onClick={onBack}>
                    <ArrowLeft />
                    <span>Back</span>
                  </SidebarMenuButton>
                ) : (
                  <SidebarMenuButton
                    className="app-no-drag"
                    size="sm"
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
        {renameTarget ? (
          <RenameWorkspaceDialog
            key={renameTarget.workspaceId}
            open
            workspaceId={renameTarget.workspaceId}
            defaultName={renameTarget.defaultName}
            initialName={renameTarget.currentName}
            onOpenChange={(next): void => {
              if (!next) setRenameTarget(null)
            }}
            onRename={onRenameWorkspace}
          />
        ) : null}
        <SessionSearchDialog
          request={sessionSearch}
          projects={sidebarProjects}
          onOpen={(hit) => openAgentSession(hit, onSelectWorkspace)}
          onClose={(): void => setSessionSearch(null)}
        />
      </>
    </OpenSessionSearchContext.Provider>
  )
}
