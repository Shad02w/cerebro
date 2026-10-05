import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { WORKSPACE_NAME_MAX_LENGTH } from '@shared/types'
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

type RenameWorkspaceDialogProps = {
  open: boolean
  workspaceId: number
  defaultName: string
  initialName: string
  onOpenChange: (open: boolean) => void
  onRename: (workspaceId: number, displayName: string | null) => Promise<void>
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 31) return true
  }
  return false
}

function nameError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Enter a name.'
  if (containsControlCharacter(trimmed)) return 'Name cannot include line breaks.'
  if ([...trimmed].length > WORKSPACE_NAME_MAX_LENGTH) {
    return `Name must be ${WORKSPACE_NAME_MAX_LENGTH} characters or fewer.`
  }
  return null
}

export function RenameWorkspaceDialog({
  open,
  workspaceId,
  defaultName,
  initialName,
  onOpenChange,
  onRename
}: RenameWorkspaceDialogProps): React.JSX.Element {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<'save' | 'reset' | null>(null)
  const pendingRef = useRef<'save' | 'reset' | null>(null)

  const finish = (): void => {
    pendingRef.current = null
    setPending(null)
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (pendingRef.current) return
    onOpenChange(nextOpen)
  }

  const run = async (kind: 'save' | 'reset', displayName: string | null): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = kind
    setPending(kind)
    setError(null)
    try {
      await onRename(workspaceId, displayName)
      finish()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename workspace.')
      finish()
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const invalid = nameError(name)
    if (invalid) {
      setError(invalid)
      return
    }
    const trimmed = name.trim()
    void run('save', trimmed === defaultName ? null : trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="app-no-drag sm:max-w-md">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Rename workspace</DialogTitle>
            <DialogDescription>
              This name is shown on the workspace row. The folder and branch stay the same.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="workspace-rename-name">Name</Label>
            <Input
              id="workspace-rename-name"
              value={name}
              autoFocus
              autoComplete="off"
              disabled={pending != null}
              data-testid="workspace-rename-input"
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError(null)
              }}
              onFocus={(event) => event.currentTarget.select()}
            />
            <p className="text-xs text-muted-foreground" data-testid="workspace-rename-default">
              Default: <span className="font-medium text-foreground">{defaultName}</span>
            </p>
            {error ? (
              <p className="text-sm text-destructive" data-testid="workspace-rename-error">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="outline"
              aria-busy={pending === 'reset'}
              data-testid="workspace-rename-reset"
              onClick={() => void run('reset', null)}
            >
              {pending === 'reset' ? <Loader2 className="animate-spin" /> : null}
              {pending === 'reset' ? 'Resetting…' : 'Reset to default'}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="ghost"
                disabled={pending != null}
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                aria-busy={pending === 'save'}
                data-testid="workspace-rename-submit"
              >
                {pending === 'save' ? <Loader2 className="animate-spin" /> : null}
                {pending === 'save' ? 'Renaming…' : 'Rename'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
