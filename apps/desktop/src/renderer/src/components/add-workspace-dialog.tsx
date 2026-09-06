import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { ProjectBranch } from '@shared/types'
import { BranchCombobox } from '@/components/branch-combobox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type AddWorkspaceDialogProps = {
  open: boolean
  projectId: number | null
  projectName: string | null
  defaultBranch: string | null
  onOpenChange: (open: boolean) => void
  onListBranches: (projectId: number) => Promise<ProjectBranch[]>
  onCreate: (projectId: number, branch: string, from?: string | null) => Promise<void>
}

type AddWorkspaceMode = 'existing' | 'new'

type BranchLoadState =
  | { status: 'idle' }
  | { status: 'ready'; branches: ProjectBranch[] }
  | { status: 'error'; message: string }

function pickBaseBranch(names: string[], preferred: string | null): string {
  if (preferred && names.includes(preferred)) return preferred
  return names[0] ?? ''
}

export function AddWorkspaceDialog({
  open,
  projectId,
  projectName,
  defaultBranch,
  onOpenChange,
  onListBranches,
  onCreate
}: AddWorkspaceDialogProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<BranchLoadState>({ status: 'idle' })
  const [mode, setMode] = useState<AddWorkspaceMode>('existing')
  const [branch, setBranch] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [from, setFrom] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const reset = (): void => {
    setLoadState({ status: 'idle' })
    setMode('existing')
    setBranch('')
    setNewBranch('')
    setFrom('')
    setSubmitting(false)
    setSubmitError(null)
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (submitting) return
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  useEffect(() => {
    if (!open || projectId == null) return

    let cancelled = false

    void onListBranches(projectId)
      .then((result) => {
        if (cancelled) return
        const available = result.filter((item) => !item.hasWorkspace)
        const allNames = result.map((item) => item.name)
        setLoadState({ status: 'ready', branches: result })
        setBranch(available[0]?.name ?? '')
        setFrom(pickBaseBranch(allNames, defaultBranch))
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to list branches.'
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, projectId, defaultBranch, onListBranches])

  const loading = open && projectId != null && loadState.status === 'idle'
  const branches = loadState.status === 'ready' ? loadState.branches : []
  const existingBranches = branches.filter((item) => !item.hasWorkspace).map((item) => item.name)
  const allBranchNames = branches.map((item) => item.name)
  const error = submitError ?? (loadState.status === 'error' ? loadState.message : null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    if (loading) {
      setSubmitError('Wait for branches to finish loading.')
      return
    }
    if (projectId == null) return

    if (mode === 'existing') {
      if (!branch) {
        setSubmitError('Select a branch.')
        return
      }
    } else if (!newBranch.trim()) {
      setSubmitError('Enter a new branch name.')
      return
    } else if (!from) {
      setSubmitError('Select a base branch.')
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      if (mode === 'existing') {
        await onCreate(projectId, branch)
      } else {
        await onCreate(projectId, newBranch.trim(), from)
      }
      reset()
      onOpenChange(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create workspace.')
      setSubmitting(false)
    }
  }

  const projectLabel = projectName ? (
    <>
      {' '}
      in <span className="font-medium text-foreground">{projectName}</span>
    </>
  ) : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="app-no-drag sm:max-w-md">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add workspace</DialogTitle>
            <DialogDescription>
              {mode === 'existing' ? (
                <>Create a git worktree from an existing branch{projectLabel}.</>
              ) : (
                <>Create a new branch and worktree based on an existing branch{projectLabel}.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div
              role="tablist"
              aria-label="Workspace type"
              className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
            >
              <Button
                type="button"
                role="tab"
                size="sm"
                variant="ghost"
                aria-selected={mode === 'existing'}
                data-testid="workspace-mode-existing"
                className={cn(
                  'h-8',
                  mode === 'existing' && 'bg-background text-foreground shadow-sm hover:bg-background'
                )}
                disabled={submitting}
                onClick={() => {
                  setMode('existing')
                  setSubmitError(null)
                }}
              >
                Existing branch
              </Button>
              <Button
                type="button"
                role="tab"
                size="sm"
                variant="ghost"
                aria-selected={mode === 'new'}
                data-testid="workspace-mode-new"
                className={cn(
                  'h-8',
                  mode === 'new' && 'bg-background text-foreground shadow-sm hover:bg-background'
                )}
                disabled={submitting}
                onClick={() => {
                  setMode('new')
                  setSubmitError(null)
                }}
              >
                New branch
              </Button>
            </div>
            {mode === 'existing' ? (
              <div className="grid gap-2">
                <Label htmlFor="workspace-branch">Branch</Label>
                {loading ? (
                  <Skeleton
                    className="h-9 w-full"
                    data-testid="workspace-branch-skeleton"
                    aria-label="Loading branches"
                  />
                ) : (
                  <BranchCombobox
                    id="workspace-branch"
                    value={branch}
                    branches={existingBranches}
                    disabled={submitting}
                    placeholder={
                      existingBranches.length ? 'Select a branch' : 'No branches available'
                    }
                    emptyLabel={
                      existingBranches.length
                        ? 'No branches match.'
                        : 'No branches available'
                    }
                    testId="workspace-branch-select"
                    onChange={setBranch}
                  />
                )}
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="workspace-new-branch">New branch</Label>
                  <Input
                    id="workspace-new-branch"
                    value={newBranch}
                    disabled={submitting || loading}
                    placeholder="feature/my-change"
                    autoComplete="off"
                    data-testid="workspace-new-branch-input"
                    onChange={(event) => setNewBranch(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="workspace-from">Based on</Label>
                  {loading ? (
                    <Skeleton
                      className="h-9 w-full"
                      data-testid="workspace-from-skeleton"
                      aria-label="Loading branches"
                    />
                  ) : (
                    <BranchCombobox
                      id="workspace-from"
                      value={from}
                      branches={allBranchNames}
                      disabled={submitting}
                      placeholder={
                        allBranchNames.length ? 'Select a base branch' : 'No branches available'
                      }
                      emptyLabel={
                        allBranchNames.length ? 'No branches match.' : 'No branches available'
                      }
                      testId="workspace-from-select"
                      onChange={setFrom}
                    />
                  )}
                </div>
              </>
            )}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" aria-busy={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting ? 'Creating…' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
