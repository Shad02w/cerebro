import { useEffect, useState } from 'react'
import { AddWorkspaceDialog } from '@/components/add-workspace-dialog'
import { AppSidebar } from '@/components/app-sidebar'
import { SettingsView } from '@/components/settings-view'
import { WorkspaceView } from '@/components/workspace-view'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useAppRoute } from '@/hooks/use-app-route'
import { useWorkspaces } from '@/hooks/use-workspaces'
import { navigate, settingsPath, workspacesPath } from '@/lib/app-route'

function TitlebarSidebarTrigger(): React.JSX.Element {
  return (
    <div className="app-no-drag fixed top-[10px] left-[78px] z-50">
      <SidebarTrigger className="app-no-drag size-6" />
    </div>
  )
}

function ExpandSidebarOnSettings({ enabled }: { enabled: boolean }): null {
  const { setOpen } = useSidebar()

  useEffect(() => {
    if (enabled) setOpen(true)
  }, [enabled, setOpen])

  return null
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
  const route = useAppRoute()
  const isSettings = route.name === 'settings'
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
      <ExpandSidebarOnSettings enabled={isSettings} />
      {isSettings ? null : <TitlebarSidebarTrigger />}
      <AppSidebar
        mode={isSettings ? 'settings' : 'workspaces'}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        settingsSection={isSettings ? route.section : 'general'}
        onSelectWorkspace={(id): void => {
          void selectWorkspace(id)
        }}
        onAddWorkspace={(): void => setDialogOpen(true)}
        onSelectSettingsSection={(section): void => {
          navigate(settingsPath(section))
        }}
        onOpenSettings={(): void => {
          navigate(settingsPath('general'))
        }}
        onBack={(): void => {
          navigate(workspacesPath())
        }}
      />
      <SidebarInset>
        {isSettings ? (
          <SettingsView section={route.section} />
        ) : (
          <>
            <WorkspaceHeader title={activeWorkspace?.name ?? 'Workspaces'} />
            <WorkspaceView
              workspace={activeWorkspace}
              loading={loading}
              error={error}
              onAddWorkspace={(): void => setDialogOpen(true)}
            />
          </>
        )}
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
