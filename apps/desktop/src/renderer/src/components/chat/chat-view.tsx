import { Fragment, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, MessageSquare, Square } from 'lucide-react'
import type { AgentAccessMode, AgentAnswer, AgentModel, ChatCommand } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import { ChatItem } from './chat-item'
import { ModelPicker } from './model-picker'
import { catalogOptions, harnessLabels } from './queries'
import { observeChatLayout } from './chat-layout'
import './chat-scrollbars.css'
import './chat-status.css'

export function ChatView({
  workspaceId,
  paneId
}: {
  workspaceId: number
  paneId: number
}): React.JSX.Element {
  const client = useQueryClient()
  const queryKey = ['chat', workspaceId, paneId]
  const view = useQuery({
    queryKey,
    queryFn: () => window.cerebro.chatCommand({ action: 'get', workspaceId, paneId }),
    staleTime: Infinity
  })
  const catalog = useQuery(catalogOptions)
  const session = view.data?.session
  const draftKey = `chat-draft:${workspaceId}:${paneId}`
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey) ?? '')
  const [selection, setSelection] = useState<AgentModel>()
  const [reasoning, setReasoning] = useState('')
  const [accessSelection, setAccessSelection] = useState<AgentAccessMode>()
  const accessMode = accessSelection ?? session?.accessMode ?? 'full'
  const selected = selection ?? session?.model ?? catalog.data?.models.find((m) => m.available)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const pendingSend = useRef<{ id: string; text: string; key?: string } | null>(null)
  const scrolling = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const busy = session?.status === 'running' || session?.status === 'waiting'
  const { mutateAsync } = useMutation({
    mutationFn: async (command: ChatCommand) => {
      await client.cancelQueries({ queryKey })
      return window.cerebro.chatCommand(command)
    },
    onSuccess: (data) => {
      client.setQueryData<typeof data>(queryKey, (previous) =>
        previous?.session?.id === data.session?.id &&
        previous?.session &&
        data.session &&
        previous.session.sequence > data.session.sequence
          ? previous
          : data
      )
      void client.invalidateQueries({ queryKey: ['chat', workspaceId] })
    }
  })
  const updateDraft = (value: string): void => {
    setDraft(value)
    localStorage.setItem(draftKey, value)
  }
  const execute = useCallback(
    async (command: Omit<ChatCommand, 'workspaceId' | 'paneId'>): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setError(null)
      try {
        await mutateAsync({ ...command, workspaceId, paneId })
        return true
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        inFlight.current = false
      }
    },
    [mutateAsync, workspaceId, paneId]
  )
  const reply = useCallback(
    (requestId: string, answer: AgentAnswer): void => {
      void execute({ action: 'reply', sessionId: session?.id, requestId, ...answer })
    },
    [execute, session?.id]
  )
  useLayoutEffect(() => {
    if (stick.current && scrolling.current)
      scrolling.current.scrollTop = scrolling.current.scrollHeight
  }, [session?.sequence, session?.error, error, view.error])
  useLayoutEffect(() => {
    if (scrolling.current && composer.current)
      return observeChatLayout(scrolling.current, composer.current, stick)
  }, [])
  const send = async (): Promise<void> => {
    if (inFlight.current) return
    if (!draft.trim()) {
      setError('Write a message first.')
      return
    }
    if (busy) {
      setError('The agent is working. Stop it or wait before sending another message.')
      return
    }
    if (!selected) {
      setError('Choose an available model first.')
      return
    }
    if (
      !pendingSend.current ||
      pendingSend.current.text !== draft ||
      pendingSend.current.key !== selected.key
    )
      pendingSend.current = { id: crypto.randomUUID(), text: draft, key: selected.key }
    stick.current = true
    if (
      await execute({
        action: 'send',
        commandId: pendingSend.current.id,
        sessionId: session?.id,
        text: draft,
        model: selected,
        reasoning: reasoning || undefined,
        accessMode
      })
    ) {
      updateDraft('')
      pendingSend.current = null
    }
  }
  return (
    <div
      className="chat-scrollbars relative flex h-full min-w-0 flex-col bg-background text-foreground"
      data-testid="chat-view"
    >
      <div
        ref={scrolling}
        onScroll={() => {
          const node = scrolling.current
          if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-40"
        data-testid="chat-transcript"
        aria-label="Conversation"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {!session?.items.length ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
              <MessageSquare className="size-7 text-muted-foreground" />
              <h2 className="text-lg font-medium">What would you like to build?</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Work with Claude Code, Codex, or Pi in this workspace.
              </p>
            </div>
          ) : (
            session.items.map((item, index) => (
              <Fragment key={item.id}>
                <ChatItem item={item} onReply={reply} />
                {item.kind !== 'user' &&
                session.items[index + 1]?.turnId !== item.turnId &&
                (item.turnId !== session.turnId || !busy) ? (
                  <div
                    role="separator"
                    aria-label="End of response"
                    className="flex items-center gap-3 py-2 text-xs text-muted-foreground"
                  >
                    <span className="h-px flex-1 bg-border" />
                    <span>End of response</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : null}
              </Fragment>
            ))
          )}
          {session?.status === 'running' ? (
            <div role="status" className="text-sm text-muted-foreground">
              <span className="chat-working">Working…</span>
            </div>
          ) : null}
          {session && session.status !== 'running' ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <span
                className={
                  busy
                    ? 'size-1.5 animate-pulse rounded-full bg-foreground'
                    : 'size-1.5 rounded-full bg-muted-foreground'
                }
              />
              {session.status === 'idle'
                ? 'Ready'
                : session.status === 'waiting'
                  ? 'Waiting for your response'
                  : session.status}
              {session.nativeId ? ' · Native session saved' : ''}
            </div>
          ) : null}
          {session?.error || error || view.error ? (
            <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">
              {error ?? session?.error ?? String(view.error)}
            </p>
          ) : null}
        </div>
      </div>
      <div
        ref={composer}
        data-testid="chat-composer"
        className="pointer-events-none absolute inset-x-0 bottom-0"
      >
        <div
          aria-hidden="true"
          data-testid="chat-list-fade"
          className="h-10 bg-gradient-to-t from-background via-background/80 to-transparent"
        />
        <div className="bg-background px-5 pb-4">
          <form
            className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border bg-background p-2 shadow-lg"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <textarea
              aria-label="Message agent"
              placeholder="Ask your agent to work on something…"
              value={draft}
              onChange={(e) => updateDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={3}
              className="max-h-48 min-h-20 w-full resize-y bg-transparent px-2 py-2 text-sm outline-none"
            />
            <div className="flex flex-wrap items-center gap-1">
              <div className="min-w-0 flex-1">
                <ModelPicker
                  selected={selected}
                  onSelect={(model) => {
                    if (session && session.model.harness !== model.harness) {
                      setError(
                        `Open a new Chat tab or pane to use ${harnessLabels[model.harness]}.`
                      )
                      return
                    }
                    setError(null)
                    setSelection(model)
                    setReasoning('')
                  }}
                />
              </div>
              <select
                aria-label="Access mode"
                title={
                  selected?.harness === 'pi'
                    ? 'Pi: Edit and Read-only limit tools and disable extensions; shell commands require Full access. Changes apply to the next message.'
                    : 'Access for the next message. Edit allows file changes; Read-only uses the harness read or plan mode.'
                }
                value={accessMode}
                onChange={(event) => setAccessSelection(event.target.value as AgentAccessMode)}
                className="max-w-36 rounded bg-transparent p-1 text-xs text-muted-foreground"
              >
                <option value="full">Full access (YOLO)</option>
                <option value="edit">Edit</option>
                <option value="read">Read-only</option>
              </select>
              {selected?.reasoning.length ? (
                <select
                  aria-label="Reasoning effort"
                  value={reasoning}
                  onChange={(e) => setReasoning(e.target.value)}
                  className="max-w-28 rounded bg-transparent p-1 text-xs text-muted-foreground"
                >
                  <option value="">Default effort</option>
                  {selected.reasoning.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              ) : null}
              {busy ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Stop agent"
                  onClick={() => {
                    void execute({ action: 'stop', sessionId: session?.id })
                  }}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : null}
              <Button type="submit" size="icon-sm" aria-label="Send message">
                <ArrowUp className="size-4" />
              </Button>
            </div>
            <p className="mt-2 px-2 text-[10px] text-muted-foreground">
              Uses your native agent configuration and login. Shift+Enter for a new line.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
