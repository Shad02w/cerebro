import { ArrowLeft, FolderGit2, GitBranch, Plus, Settings } from 'lucide-react'
import type { Workspace } from '@shared/types'
import type { SettingsSectionId } from '@/lib/app-route'
import { SETTINGS_SECTIONS } from '@/lib/settings-sections'
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail
} from '@/components/ui/sidebar'

type AppSidebarProps = {
  mode: 'workspaces' | 'settings'
  workspaces: Workspace[]
  activeWorkspaceId: number | null
  settingsSection: SettingsSectionId
  onSelectWorkspace: (workspaceId: number) => void
  onAddWorkspace: () => void
  onSelectSettingsSection: (section: SettingsSectionId) => void
  onOpenSettings: () => void
  onBack: () => void
}

export function AppSidebar({
  mode,
  workspaces,
  activeWorkspaceId,
  settingsSection,
  onSelectWorkspace,
  onAddWorkspace,
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
            <FolderGit2 className="size-4" />
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
            <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
            <SidebarGroupAction
              className="app-no-drag"
              title="Add workspace"
              onClick={onAddWorkspace}
            >
              <Plus />
              <span className="sr-only">Add workspace</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              {workspaces.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-sidebar-foreground/60">
                  No workspaces yet. Use + to clone a Git repository.
                </p>
              ) : (
                <SidebarMenu>
                  {workspaces.map((workspace) => (
                    <SidebarMenuItem key={workspace.id}>
                      <SidebarMenuButton
                        className="app-no-drag"
                        isActive={workspace.id === activeWorkspaceId}
                        onClick={(): void => onSelectWorkspace(workspace.id)}
                      >
                        <FolderGit2 />
                        <span>{workspace.name}</span>
                      </SidebarMenuButton>
                      {workspace.repositories.length > 0 ? (
                        <SidebarMenuSub>
                          {workspace.repositories.map((repository) => (
                            <SidebarMenuSubItem key={repository.id}>
                              <SidebarMenuSubButton asChild size="sm">
                                <span>
                                  <GitBranch />
                                  <span>{repository.name}</span>
                                </span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      ) : null}
                    </SidebarMenuItem>
                  ))}
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
              <SidebarMenuButton className="app-no-drag rounded-full" onClick={onBack}>
                <ArrowLeft />
                <span>Back</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton className="app-no-drag rounded-full" onClick={onOpenSettings}>
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
