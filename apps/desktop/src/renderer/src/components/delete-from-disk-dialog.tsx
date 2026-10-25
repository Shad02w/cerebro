import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

export type DeleteFromDiskTarget =
  | { kind: 'project'; projectId: number; name: string }
  | { kind: 'workspace'; workspaceId: number; name: string; path: string }

type DeleteFromDiskDialogProps = {
  target: DeleteFromDiskTarget
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

function detailLines(target: DeleteFromDiskTarget): string[] {
  if (target.kind === 'workspace') {
    return [
      'Removes this row from the sidebar.',
      target.path
        ? `Deletes the checkout folder at ${target.path} from disk.`
        : 'Deletes the checkout folder from disk.',
      'Keeps the branch in the repository.'
    ]
  }
  return [
    'Removes the project and its rows from the sidebar.',
    'Deletes the worktree checkouts Cerebro created from disk.',
    'Keeps the main checkout and any folder you opened.'
  ]
}

/**
 * Confirms the destructive half of the sidebar pair: `Remove from sidebar`
 * unregisters rows only, while `Delete from disk` also removes Cerebro-created
 * worktree checkouts from the filesystem.
 */
export function DeleteFromDiskDialog({
  target,
  pending,
  error,
  onCancel,
  onConfirm
}: DeleteFromDiskDialogProps): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(next): void => {
        if (!next && !pending) onCancel()
      }}
    >
      <DialogContent className="app-no-drag sm:max-w-md" data-testid="delete-from-disk-dialog">
        <DialogHeader>
          <DialogTitle>Delete from disk?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{target.name}</span> also loses files on
            disk, unlike <span className="whitespace-nowrap">“Remove from sidebar”</span>. This
            can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1.5 rounded-md border border-border bg-muted/40 p-3 text-sm">
          {detailLines(target).map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="text-sm text-destructive" role="alert" data-testid="delete-from-disk-error">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            data-testid="delete-from-disk-cancel"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            aria-busy={pending}
            data-testid="delete-from-disk-confirm"
            onClick={onConfirm}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {pending ? 'Deleting…' : 'Delete from disk'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
