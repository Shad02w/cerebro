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
import { SuccessToast, type ToastTone } from '@/components/success-toast'
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
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null)
  const toastId = useRef(0)
  const notify = (message: string, tone: ToastTone): void =>
    setToast({ id: ++toastId.current, message, tone })
  const copyResponse = async (): Promise<void> => {
    if (await copy(text)) notify('Response copied to clipboard.', 'success')
    else notify('Could not copy response.', 'error')
  }
  const fork = async (target: 'tab' | 'pane'): Promise<void> => {
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
              focus: true,
              ...(repositoryId != null ? { repositoryId } : {})
            })
          : await window.cerebro.layoutCommand({
              target: 'pane',
              action: 'split',
              kind: 'chat',
              direction: 'auto',
              workspaceId,
              paneId,
              focus: true
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
      // Electron prefixes errors thrown across IPC; the reason after it is what the user needs.
      const reason = error instanceof Error ? error.message : String(error)
      notify(reason.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, ''), 'error')
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
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Fork conversation"
              title="Fork conversation"
              className="text-muted-foreground"
              data-testid="chat-fork-trigger"
            />
          }
        >
          <GitFork aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-64">
          <DropdownMenuItem
            className="text-xs"
            data-testid="chat-fork-new-tab"
            onClick={() => void fork('tab')}
          >
            Fork in a new tab
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-xs"
            data-testid="chat-fork-new-pane"
            onClick={() => void fork('pane')}
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
      <SuccessToast
        toast={toast}
        onDismiss={() => setToast(null)}
        testId="chat-turn-copy-toast"
        tone={toast?.tone}
      />
    </div>
  )
}
