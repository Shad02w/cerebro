import type { TerminalThemeId } from '@shared/terminal-themes'
import { Plus } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { BrainMark } from '@/components/brain-mark'
import { Button } from '@/components/ui/button'
import { TerminalStack } from '@/components/terminal-stack'

type WorkspaceViewProps = {
  visible: boolean
  workspace: Workspace | null
  activeWorkspaceId: number | null
  hasProjects: boolean
  loading: boolean
  error: string | null
  terminalTheme: TerminalThemeId | null
  terminalFontSize: number | null
  terminalFontFamily: string | null
  onAddProject: () => void
  onSelectWorkspace: (workspaceId: number) => void
}

export function WorkspaceView({
  visible,
  workspace,
  activeWorkspaceId,
  hasProjects,
  loading,
  error,
  terminalTheme,
  terminalFontSize,
  terminalFontFamily,
  onAddProject,
  onSelectWorkspace
}: WorkspaceViewProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <BrainMark pulse />
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!workspace ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-8 text-center">
          <BrainMark />
          {hasProjects ? null : (
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Create your first project</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Clone a Git repository or open a folder to create a project and open a workspace
                terminal.
              </p>
            </div>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {hasProjects ? null : (
            <Button onClick={onAddProject}>
              <Plus />
              Add project
            </Button>
          )}
        </div>
      ) : null}
      {workspace && error ? (
        <div className="absolute top-2 right-2 left-2 z-20 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      <TerminalStack
        visible={visible}
        activeWorkspaceId={activeWorkspaceId}
        themeId={terminalTheme}
        fontSize={terminalFontSize}
        fontFamily={terminalFontFamily}
        onSelectWorkspace={onSelectWorkspace}
      />
    </div>
  )
}
