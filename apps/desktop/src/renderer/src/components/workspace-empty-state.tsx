import { FileDiff, MessageSquare, SquareTerminal } from 'lucide-react'
import { BrainMark } from '@/components/brain-mark'
import { Button } from '@/components/ui/button'
import { ShortcutKbd, useKeybindBinding } from '@/keybinds'

type WorkspaceEmptyStateProps = {
  onNewTerminal: () => void
  onOpenChat: () => void
  onOpenChanges: () => void
}

export function WorkspaceEmptyState({
  onNewTerminal,
  onOpenChanges,
  onOpenChat
}: WorkspaceEmptyStateProps): React.JSX.Element {
  const chatHotkey = useKeybindBinding('newChat')
  const terminalHotkey = useKeybindBinding('newTerminal')
  const changesHotkey = useKeybindBinding('openChanges')

  return (
    <div
      data-testid="workspace-empty-state"
      className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center"
    >
      <BrainMark />
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Start in this workspace</h2>
        <p className="text-sm text-muted-foreground">
          Chat with an agent, open a terminal, or review your changes.
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <Button variant="ghost" className="h-10 justify-start gap-3" onClick={onOpenChat}>
          <MessageSquare />
          New Chat tab
          <ShortcutKbd hotkey={chatHotkey} className="ml-auto" />
        </Button>
        <Button variant="ghost" className="h-10 justify-start gap-3" onClick={onNewTerminal}>
          <SquareTerminal />
          New terminal
          <ShortcutKbd hotkey={terminalHotkey} className="ml-auto" />
        </Button>
        <Button variant="ghost" className="h-10 justify-start gap-3" onClick={onOpenChanges}>
          <FileDiff />
          New Changes tab
          <ShortcutKbd hotkey={changesHotkey} className="ml-auto" />
        </Button>
      </div>
    </div>
  )
}
