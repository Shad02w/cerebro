import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { ProjectBranch } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

type AddWorkspaceDialogProps = {
  open: boolean
  projectId: number | null
  projectName: string | null
  onOpenChange: (open: boolean) => void
  onListBranches: (projectId: number) => Promise<ProjectBranch[]>
  onCreate: (projectId: number, branch: string) => Promise<void>
}

type BranchLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; branches: ProjectBranch[]; branch: string }
  | { status: 'error'; message: string }

export function AddWorkspaceDialog({
  open,
  projectId,
  projectName,
  onOpenChange,
  onListBranches,
  onCreate
}: AddWorkspaceDialogProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<BranchLoadState>({ status: 'idle' })
  const [branch, setBranch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const reset = (): void => {
    setLoadState({ status: 'idle' })
    setBranch('')
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
        setLoadState({
          status: 'ready',
          branches: available,
          branch: available[0]?.name ?? ''
        })
        setBranch(available[0]?.name ?? '')
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
  }, [open, projectId, onListBranches])

  // Show loading while the first fetch for this open session is in flight.
  const loading = open && projectId != null && loadState.status === 'idle'
  const branches = loadState.status === 'ready' ? loadState.branches : []
  const error = submitError ?? (loadState.status === 'error' ? loadState.message : null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (projectId == null || !branch) {
      setSubmitError('Select a branch.')
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      await onCreate(projectId, branch)
      reset()
      onOpenChange(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create workspace.')
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="app-no-drag sm:max-w-md">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add workspace</DialogTitle>
            <DialogDescription>
              Create a git worktree from an existing branch
              {projectName ? (
                <>
                  {' '}
                  in <span className="font-medium text-foreground">{projectName}</span>
                </>
              ) : null}
              .
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="workspace-branch">Branch</Label>
              {loading ? (
                <Skeleton
                  className="h-9 w-full"
                  data-testid="workspace-branch-skeleton"
                  aria-label="Loading branches"
                />
              ) : (
                <Select value={branch || undefined} onValueChange={setBranch} disabled={submitting}>
                  <SelectTrigger
                    id="workspace-branch"
                    className="w-full"
                    data-testid="workspace-branch-select"
                  >
                    <SelectValue
                      placeholder={branches.length ? 'Select a branch' : 'No branches available'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((item) => (
                      <SelectItem key={item.name} value={item.name}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
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
            <Button type="submit" disabled={submitting || loading || !branch}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting ? 'Creating…' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
