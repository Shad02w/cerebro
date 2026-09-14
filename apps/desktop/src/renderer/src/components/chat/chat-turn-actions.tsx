import { useRef, useState } from 'react'
import { Copy, GitFork } from 'lucide-react'
import type { AgentCapabilities } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SuccessToast } from '@/components/success-toast'
import { useClipboard } from '@/hooks/use-clipboard'

/** Copy and fork actions for one completed turn (a user message + its response). */
export function ChatTurnActions({
  workspaceId,
  paneId,
  repositoryId,
  sessionId,
  turnId,
  text,
  forkCapability
}: {
  workspaceId: number
  paneId: number
  repositoryId: number | null
  sessionId: string
  turnId: string
  text: string
  forkCapability?: AgentCapabilities['fork']
}): React.JSX.Element {
  const copy = useClipboard()
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const [copyError, setCopyError] = useState(false)
  const [forkError, setForkError] = useState<string | null>(null)
  const toastId = useRef(0)
  const copyResponse = async (): Promise<void> => {
    setToast(null)
    setCopyError(false)
    if (await copy(text))
      setToast({ id: ++toastId.current, message: 'Response copied to clipboard.' })
    else setCopyError(true)
  }
  const fork = async (target: 'tab' | 'pane'): Promise<void> => {
    setForkError(null)
    try {
      const forked = await window.cerebro.chatCommand({
        action: 'fork',
        workspaceId,
        paneId,
        sessionId,
        turnId
      })
      if (!forked.session) throw new Error('Fork did not return a conversation.')
      const reply =
        target === 'tab'
          ? await window.cerebro.layoutCommand({
              target: 'tab',
              action: 'create',
              kind: 'chat',
              workspaceId,
              ...(repositoryId != null ? { repositoryId } : {})
            })
          : await window.cerebro.layoutCommand({
              target: 'pane',
              action: 'split',
              kind: 'chat',
              direction: 'auto',
              workspaceId,
              paneId
            })
      const newPaneId =
        target === 'tab'
          ? (reply.result as { activePaneId: number }).activePaneId
          : (reply.result as { id: number }).id
      await window.cerebro.chatCommand({
        action: 'open',
        workspaceId,
        paneId: newPaneId,
        sessionId: forked.session.id
      })
    } catch (error) {
      setForkError(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div className="flex items-center gap-0.5" data-testid="chat-turn-actions">
      {text ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Copy response"
          title="Copy response"
          className="text-muted-foreground"
          onClick={() => void copyResponse()}
        >
          <Copy aria-hidden="true" />
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Fork conversation"
            title="Fork conversation"
            className="text-muted-foreground"
            data-testid="chat-fork-trigger"
          >
            <GitFork aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-64">
          <DropdownMenuItem
            className="text-xs"
            data-testid="chat-fork-new-tab"
            onSelect={() => void fork('tab')}
          >
            Fork in a new tab
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-xs"
            data-testid="chat-fork-new-pane"
            onSelect={() => void fork('pane')}
          >
            Fork in a new pane
          </DropdownMenuItem>
          {forkCapability === 'emulated' ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              This agent can&apos;t natively branch a conversation. The fork starts a new native
              session seeded with the visible messages only.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {copyError ? (
        <p role="alert" className="text-xs text-destructive">
          Could not copy response.
        </p>
      ) : null}
      {forkError ? (
        <p role="alert" className="text-xs text-destructive">
          {forkError}
        </p>
      ) : null}
      <SuccessToast toast={toast} onDismiss={() => setToast(null)} testId="chat-turn-copy-toast" />
    </div>
  )
}
