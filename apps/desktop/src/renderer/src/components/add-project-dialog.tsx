import { type FormEvent, useState } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'

function formatDialogError(err: unknown, fallback: string): string {
  const raw =
    err instanceof Error && err.message ? err.message : typeof err === 'string' ? err : fallback
  const stripped = raw
    .replace(/Error invoking remote method '[^']+':\s*/gi, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  if (/not a git repository/i.test(raw)) {
    return 'This folder looks like a git repository, but Git could not open it. If it is a submodule, initialize it first, or choose a different folder.'
  }

  return stripped || fallback
}

type AddProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultCloneDir: string | null
  onCreate: (gitUrl: string) => Promise<void>
  onPickDirectory: () => Promise<string | null>
  onCreateFromDirectory: (directory: string) => Promise<void>
}

export function AddProjectDialog({
  open,
  onOpenChange,
  defaultCloneDir,
  onCreate,
  onPickDirectory,
  onCreateFromDirectory
}: AddProjectDialogProps): React.JSX.Element {
  const [gitUrl, setGitUrl] = useState('')
  const [submitting, setSubmitting] = useState<'clone' | 'directory' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = submitting != null

  const reset = (): void => {
    setGitUrl('')
    setError(null)
    setSubmitting(null)
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (busy) return
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const url = gitUrl.trim()
    if (!url) {
      setError('Enter a Git URL, or choose a folder.')
      return
    }

    setSubmitting('clone')
    setError(null)
    try {
      await onCreate(url)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(formatDialogError(err, 'Failed to clone the repository.'))
      setSubmitting(null)
    }
  }

  const handleChooseFolder = async (): Promise<void> => {
    setError(null)
    setSubmitting('directory')
    try {
      const directory = await onPickDirectory()
      if (!directory) {
        setSubmitting(null)
        return
      }
      await onCreateFromDirectory(directory)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(formatDialogError(err, 'Failed to add the folder.'))
      setSubmitting(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="app-no-drag sm:max-w-md">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add project</DialogTitle>
            <DialogDescription>
              Paste a Git URL to clone the default branch into{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {defaultCloneDir ?? '~/cerebro'}
              </code>
              , or choose any folder. A folder with multiple git repositories is added as a
              multi-root workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="git-url">Git URL</Label>
              <Input
                id="git-url"
                autoFocus
                value={gitUrl}
                disabled={busy}
                placeholder="https://github.com/org/repo.git"
                onChange={(event): void => setGitUrl(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              data-testid="add-project-choose-folder"
              onClick={(): void => {
                void handleChooseFolder()
              }}
            >
              {submitting === 'directory' ? <Loader2 className="animate-spin" /> : <FolderOpen />}
              {submitting === 'directory' ? 'Adding…' : 'Choose folder'}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {submitting === 'clone' ? <Loader2 className="animate-spin" /> : null}
              {submitting === 'clone' ? 'Cloning…' : 'Clone repository'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
