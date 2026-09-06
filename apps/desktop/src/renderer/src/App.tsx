import { useEffect, useState } from 'react'
import { AddProjectDialog } from '@/components/add-project-dialog'
import { AddWorkspaceDialog } from '@/components/add-workspace-dialog'
import { AppSidebar } from '@/components/app-sidebar'
import { SettingsView } from '@/components/settings-view'
import { WorkspaceView } from '@/components/workspace-view'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useAppRoute } from '@/hooks/use-app-route'
import { useGitHub } from '@/hooks/use-github'
import { useProjects } from '@/hooks/use-projects'
import { useSettings } from '@/hooks/use-settings'
import { KeybindProvider, useKeybindHandler } from '@/keybinds'
import { navigate, projectsPath, settingsPath } from '@/lib/app-route'
import { TITLEBAR_HEIGHT, TITLEBAR_TRIGGER_LEFT } from '@/lib/titlebar'
import type { Project } from '@shared/types'

function WindowDragOverlay({
  showSidebarTrigger
}: {
  showSidebarTrigger: boolean
}): React.JSX.Element {
  return (
    <>
      <div
        data-testid="window-drag-overlay"
        className="app-drag-region fixed inset-x-0 top-0 z-40"
        style={{ height: TITLEBAR_HEIGHT }}
      />
      {showSidebarTrigger ? (
        // Sibling of the overlay: a nested trigger is trapped in the overlay's z-40
        // stacking context and the z-50 tab bar covers it when the sidebar collapses.
        <div
          data-testid="titlebar-sidebar-trigger"
          className="app-no-drag fixed top-0 z-[60] flex items-center"
          style={{ left: TITLEBAR_TRIGGER_LEFT, height: TITLEBAR_HEIGHT }}
        >
          <SidebarTrigger size="icon-xs" className="app-no-drag size-6" />
        </div>
      ) : null}
    </>
  )
}

function ExpandSidebarOnSettings({ enabled }: { enabled: boolean }): null {
  const { setOpen } = useSidebar()

  useEffect(() => {
    if (enabled) setOpen(true)
  }, [enabled, setOpen])

  return null
}

function SidebarKeybindBridge(): null {
  const { toggleSidebar } = useSidebar()
  useKeybindHandler('toggleSidebar', () => {
    toggleSidebar()
    return true
  })
  return null
}

function App(): React.JSX.Element {
  const route = useAppRoute()
  const isSettings = route.name === 'settings'
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [workspaceDialogProject, setWorkspaceDialogProject] = useState<Project | null>(null)
  const {
    projects,
    activeWorkspaceId,
    activeWorkspace,
    loading,
    error,
    createProject,
    createProjectFromDirectory,
    selectWorkspace,
    createWorkspace,
    removeWorkspace,
    removeProject,
    listProjectBranches
  } = useProjects()
  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
    update: updateSettings,
    pickDirectory,
    refresh: refreshSettings
  } = useSettings()
  const {
    status: githubStatus,
    loading: githubLoading,
    error: githubError,
    beginDeviceFlow,
    cancelDeviceFlow,
    disconnect: disconnectGitHub
  } = useGitHub()

  useEffect(() => {
    if (isSettings) void refreshSettings().catch(() => undefined)
  }, [isSettings, refreshSettings])

  const handleSelectWorkspace = (id: number): void => {
    navigate(projectsPath())
    void selectWorkspace(id)
  }

  return (
    <SidebarProvider className="h-full">
      <KeybindProvider overrides={settings?.keybinds}>
        <SidebarKeybindBridge />
        <ExpandSidebarOnSettings enabled={isSettings} />
        <WindowDragOverlay showSidebarTrigger={!isSettings} />
        <AppSidebar
          mode={isSettings ? 'settings' : 'projects'}
          projects={projects}
          activeWorkspaceId={activeWorkspaceId}
          settingsSection={isSettings ? route.section : 'general'}
          onSelectWorkspace={handleSelectWorkspace}
          onAddProject={(): void => setProjectDialogOpen(true)}
          onAddWorkspace={(project): void => setWorkspaceDialogProject(project)}
          onRemoveProject={(projectId, deleteFiles): void => {
            void removeProject(projectId, deleteFiles)
          }}
          onRemoveWorkspace={(workspaceId, deleteFiles): void => {
            void removeWorkspace(workspaceId, deleteFiles)
          }}
          onSelectSettingsSection={(section): void => {
            navigate(settingsPath(section))
          }}
          onOpenSettings={(): void => {
            navigate(settingsPath('general'))
          }}
          onBack={(): void => {
            navigate(projectsPath())
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
            <WorkspaceView
              workspace={activeWorkspace}
              activeWorkspaceId={activeWorkspaceId}
              hasProjects={projects.length > 0}
              loading={loading}
              error={error}
              terminalFontSize={settings?.terminalFontSize ?? null}
              terminalFontFamily={settings?.terminalFontFamily ?? null}
              onAddProject={(): void => setProjectDialogOpen(true)}
              onSelectWorkspace={handleSelectWorkspace}
            />
          )}
        </SidebarInset>
        <AddProjectDialog
          open={projectDialogOpen}
          onOpenChange={setProjectDialogOpen}
          defaultCloneDir={settings?.defaultCloneDir ?? null}
          onCreate={async (gitUrl): Promise<void> => {
            await createProject(gitUrl)
          }}
          onPickDirectory={(): Promise<string | null> => window.cerebro.pickProjectDirectory()}
          onCreateFromDirectory={async (directory): Promise<void> => {
            await createProjectFromDirectory(directory)
          }}
        />
        <AddWorkspaceDialog
          open={workspaceDialogProject != null}
          projectId={workspaceDialogProject?.id ?? null}
          projectName={workspaceDialogProject?.name ?? null}
          onOpenChange={(open): void => {
            if (!open) setWorkspaceDialogProject(null)
          }}
          onListBranches={listProjectBranches}
          onCreate={async (projectId, branch): Promise<void> => {
            await createWorkspace(projectId, branch)
          }}
        />
      </KeybindProvider>
    </SidebarProvider>
  )
}

export default App
