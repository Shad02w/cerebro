import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

/** Confirms a rewind that has to stop live work first. A rewind of an idle session skips it. */
export function ChatRewindDialog({
  stops,
  onCancel,
  onConfirm
}: {
  stops: string[]
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(next): void => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="app-no-drag sm:max-w-md" data-testid="chat-rewind-dialog">
        <DialogHeader>
          <DialogTitle>Stop and rewind?</DialogTitle>
          <DialogDescription>
            Rewinding hides this prompt and everything after it. Changes the agent made to files are
            not restored.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1.5 rounded-md border border-border bg-muted/40 p-3 text-sm">
          {stops.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="ghost" data-testid="chat-rewind-cancel" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" data-testid="chat-rewind-confirm" onClick={onConfirm}>
            Stop and rewind
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
