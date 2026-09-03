import { FolderGit2, Plus } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { Button } from '@/components/ui/button'
import { TerminalStack } from '@/components/terminal-stack'

type WorkspaceViewProps = {
  workspace: Workspace | null
  activeWorkspaceId: number | null
  loading: boolean
  error: string | null
  defaultCloneDir: string | null
  terminalFontSize: number | null
  terminalFontFamily: string | null
  onAddWorkspace: () => void
}

export function WorkspaceView({
  workspace,
  activeWorkspaceId,
  loading,
  error,
  terminalFontSize,
  terminalFontFamily,
  onAddWorkspace
}: WorkspaceViewProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading workspaces…
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!workspace ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-8 text-center">
          <FolderGit2 className="size-10 text-muted-foreground" />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Create your first workspace</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Link a Git repository to a workspace.
            </p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={onAddWorkspace}>
            <Plus />
            Add workspace
          </Button>
        </div>
      ) : null}
      {workspace && error ? (
        <div className="absolute top-2 right-2 left-2 z-20 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      <TerminalStack
        activeWorkspaceId={activeWorkspaceId}
        fontSize={terminalFontSize}
        fontFamily={terminalFontFamily}
      />
    </div>
  )
}
