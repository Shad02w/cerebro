import { FolderGit2, GitBranch, Plus } from 'lucide-react'
import type { Workspace } from '@shared/types'
import {
  Sidebar,
  SidebarContent,
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
  workspaces: Workspace[]
  activeWorkspaceId: number | null
  onSelectWorkspace: (workspaceId: number) => void
  onAddWorkspace: () => void
}

export function AppSidebar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onAddWorkspace
}: AppSidebarProps): React.JSX.Element {
  return (
    <Sidebar collapsible="offcanvas">
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
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
