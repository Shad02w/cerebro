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
import { navigate, projectsPath, settingsPath } from '@/lib/app-route'
import type { Project } from '@shared/types'

// Matches BrowserWindow trafficLightPosition in src/main/index.ts.
// Lights are 12px; icon-xs is 24px. Center the control on the lights so the
// 12px icon lines up with the circles (top-aligning the 24px hit target sits too low).
const TRAFFIC_LIGHT_Y = 16
const TRAFFIC_LIGHT_SIZE = 12
const TITLEBAR_TRIGGER_LEFT = 78
const TITLEBAR_TRIGGER_TOP = TRAFFIC_LIGHT_Y + TRAFFIC_LIGHT_SIZE / 2

function WindowDragOverlay({
  showSidebarTrigger
}: {
  showSidebarTrigger: boolean
}): React.JSX.Element {
  return (
    <div
      data-testid="window-drag-overlay"
      className="app-drag-region fixed inset-x-0 top-0 z-40 h-10"
    >
      {showSidebarTrigger ? (
        <div
          className="app-no-drag absolute -translate-y-1/2"
          style={{ top: TITLEBAR_TRIGGER_TOP, left: TITLEBAR_TRIGGER_LEFT }}
        >
          <SidebarTrigger size="icon-xs" className="app-no-drag size-6" />
        </div>
      ) : null}
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
      <WindowDragOverlay showSidebarTrigger={!isSettings} />
      <AppSidebar
        mode={isSettings ? 'settings' : 'projects'}
        projects={projects}
        activeWorkspaceId={activeWorkspaceId}
        settingsSection={isSettings ? route.section : 'general'}
        onSelectWorkspace={(id): void => {
          navigate(projectsPath())
          void selectWorkspace(id)
        }}
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
    </SidebarProvider>
  )
}

export default App
