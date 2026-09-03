import { useEffect, useState } from 'react'
import { AddWorkspaceDialog } from '@/components/add-workspace-dialog'
import { AppSidebar } from '@/components/app-sidebar'
import { SettingsView } from '@/components/settings-view'
import { WorkspaceView } from '@/components/workspace-view'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useAppRoute } from '@/hooks/use-app-route'
import { useGitHub } from '@/hooks/use-github'
import { useSettings } from '@/hooks/use-settings'
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

function WorkspaceHeader(): React.JSX.Element {
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'

  return (
    <header
      data-testid="content-drag-header"
      className={collapsed ? 'flex h-10 shrink-0 items-center' : 'flex h-3 shrink-0 items-center'}
    >
      {collapsed ? <div className="w-[108px] shrink-0" /> : null}
      <div className="app-drag-region h-full min-w-0 flex-1" />
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
  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
    update: updateSettings,
    pickDirectory
  } = useSettings()
  const {
    status: githubStatus,
    loading: githubLoading,
    error: githubError,
    beginDeviceFlow,
    cancelDeviceFlow,
    disconnect: disconnectGitHub
  } = useGitHub()

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
          navigate(workspacesPath())
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
          <SettingsView
            section={route.section}
            settings={settings}
            loading={settingsLoading}
            error={settingsError}
            onUpdate={updateSettings}
            onPickDirectory={pickDirectory}
            githubStatus={githubStatus}
            githubLoading={githubLoading}
            githubError={githubError}
            onConnectGitHub={beginDeviceFlow}
            onCancelGitHub={cancelDeviceFlow}
            onDisconnectGitHub={disconnectGitHub}
          />
        ) : (
          <>
            <WorkspaceHeader />
            <WorkspaceView
              workspace={activeWorkspace}
              activeWorkspaceId={activeWorkspaceId}
              loading={loading}
              error={error}
              defaultCloneDir={settings?.defaultCloneDir ?? null}
              terminalFontSize={settings?.terminalFontSize ?? null}
              terminalFontFamily={settings?.terminalFontFamily ?? null}
              onAddWorkspace={(): void => setDialogOpen(true)}
            />
          </>
        )}
      </SidebarInset>
      <AddWorkspaceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultCloneDir={settings?.defaultCloneDir ?? null}
        onCreate={async (gitUrl): Promise<void> => {
          await createWorkspace(gitUrl)
        }}
      />
    </SidebarProvider>
  )
}

export default App
