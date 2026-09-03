import { FolderGit2, GitBranch, Plus } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

type WorkspaceViewProps = {
  workspace: Workspace | null
  loading: boolean
  error: string | null
  onAddWorkspace: () => void
}

export function WorkspaceView({
  workspace,
  loading,
  error,
  onAddWorkspace
}: WorkspaceViewProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading workspaces…
      </div>
    )
  }

  if (!workspace) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <FolderGit2 className="size-10 text-muted-foreground" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Create your first workspace</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Link a Git repository to a workspace. Cerebro clones the default branch into{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">~/cerebro</code>.
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button onClick={onAddWorkspace}>
          <Plus />
          Add workspace
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Workspace
        </p>
        <h2 className="mt-1 text-2xl font-semibold">{workspace.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One Git repository is mapped to this workspace. You can keep several workspaces open and
          switch between them in the sidebar.
        </p>
      </div>
      <Separator />
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Linked repositories</h3>
        <div className="grid gap-3">
          {workspace.repositories.map((repository) => (
            <div key={repository.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{repository.name}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{repository.gitUrl}</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                  <GitBranch className="size-3" />
                  {repository.defaultBranch}
                </span>
              </div>
              <p className="mt-3 truncate font-mono text-xs text-muted-foreground">
                {repository.localPath}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
