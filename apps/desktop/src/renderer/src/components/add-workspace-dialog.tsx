import { type FormEvent, useState } from 'react'
import { Loader2 } from 'lucide-react'
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

type AddWorkspaceDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (gitUrl: string) => Promise<void>
}

export function AddWorkspaceDialog({
  open,
  onOpenChange,
  onCreate
}: AddWorkspaceDialogProps): React.JSX.Element {
  const [gitUrl, setGitUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setGitUrl('')
    setError(null)
    setSubmitting(false)
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (submitting) return
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const url = gitUrl.trim()
    if (!url) {
      setError('Enter a Git URL.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onCreate(url)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone the repository.')
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
              Paste a Git URL. Cerebro clones the default branch into{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">~/cerebro</code> and maps that
              repository to a new workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="git-url">Git URL</Label>
              <Input
                id="git-url"
                autoFocus
                value={gitUrl}
                disabled={submitting}
                placeholder="https://github.com/org/repo.git"
                onChange={(event): void => setGitUrl(event.target.value)}
              />
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
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting ? 'Cloning…' : 'Clone repository'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
