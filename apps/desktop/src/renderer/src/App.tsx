import { useState } from 'react'
import { AddWorkspaceDialog } from '@/components/add-workspace-dialog'
import { AppSidebar } from '@/components/app-sidebar'
import { WorkspaceView } from '@/components/workspace-view'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useWorkspaces } from '@/hooks/use-workspaces'

function TitlebarSidebarTrigger(): React.JSX.Element {
  return (
    <div className="app-no-drag fixed top-[10px] left-[78px] z-50">
      <SidebarTrigger className="app-no-drag size-6" />
    </div>
  )
}

function WorkspaceHeader({ title }: { title: string }): React.JSX.Element {
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'

  return (
    <header className="flex h-10 shrink-0 items-center border-b">
      {collapsed ? <div className="w-[108px] shrink-0" /> : null}
      <div className="app-drag-region flex h-full min-w-0 flex-1 items-center px-3">
        <span className="text-sm text-muted-foreground">{title}</span>
      </div>
    </header>
  )
}

function App(): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false)
  const {
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    loading,
    error,
    createWorkspace,
    selectWorkspace
  } = useWorkspaces()

  return (
    <SidebarProvider className="h-full">
      <TitlebarSidebarTrigger />
      <AppSidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={(id): void => {
          void selectWorkspace(id)
        }}
        onAddWorkspace={(): void => setDialogOpen(true)}
      />
      <SidebarInset>
        <WorkspaceHeader title={activeWorkspace?.name ?? 'Workspaces'} />
        <WorkspaceView
          workspace={activeWorkspace}
          loading={loading}
          error={error}
          onAddWorkspace={(): void => setDialogOpen(true)}
        />
      </SidebarInset>
      <AddWorkspaceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={async (gitUrl): Promise<void> => {
          await createWorkspace(gitUrl)
        }}
      />
    </SidebarProvider>
  )
}

export default App
