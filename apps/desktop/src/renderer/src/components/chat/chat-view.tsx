import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, ImagePlus, MessageSquare, Square } from 'lucide-react'
import {
  resolveNewAgentModel,
  type AgentAccessMode,
  type AgentAnswer,
  type AgentModel,
  type ChatCommand
} from '@cerebro/core'
import {
  DEFAULT_AGENT_BACKGROUND,
  type AgentBackground,
  type ComposerVimMode,
  type AgentModelDefaults,
  type LastAgent
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { StarsBackground } from '@/lib/stars-background'
import { cn } from '@/lib/utils'
import { ChatItem } from './chat-item'
import { ChatTurnActions } from './chat-turn-actions'
import { ChatQueue } from './chat-queue'
import { AttachmentStrip, DropOverlay } from './chat-composer-attachments'
import { ComposerEditor, type ComposerEditorHandle } from './composer-editor'
import { VimModeBadge } from './vim-mode-badge'
import type { Mode as VimMode } from 'vim-prosemirror'
import { chatImageAccept, useComposerDraft } from './use-composer-draft'
import { ModelPicker } from './model-picker'
import { ContextUsageRing } from './context-usage-ring'
import { catalogOptions, harnessLabels } from './queries'
import { observeChatLayout } from './chat-layout'
import './chat-scrollbars.css'
import './chat-status.css'

export function ChatView({
  workspaceId,
  paneId,
  visible = true,
  agentBackground = DEFAULT_AGENT_BACKGROUND,
  composerVim = false,
  composerVimMode = 'insert',
  agentModelDefaults,
  lastAgent = null,
  onRememberAgent
}: {
  workspaceId: number
  paneId: number
  visible?: boolean
  agentBackground?: AgentBackground
  composerVim?: boolean
  composerVimMode?: ComposerVimMode
  agentModelDefaults: AgentModelDefaults
  lastAgent?: LastAgent | null
  onRememberAgent?: (model: AgentModel) => void
}): React.JSX.Element {
  const client = useQueryClient()
  const [vimMode, setVimMode] = useState<VimMode | null>(null)
  const vimOptions = useMemo(
    () => ({ enabled: composerVim, initialMode: composerVimMode }),
    [composerVim, composerVimMode]
  )
  const queryKey = ['chat', workspaceId, paneId]
  const view = useQuery({
    queryKey,
    queryFn: () => window.cerebro.chatCommand({ action: 'get', workspaceId, paneId }),
    staleTime: Infinity
  })
  const catalog = useQuery(catalogOptions)
  // Pending with no data is "not confirmed yet" — never treat it as empty.
  const loading = !view.data && view.isPending
  const session = view.data?.session
  const items = session?.items
  const turnTexts = useMemo(() => {
    const texts = new Map<string, string[]>()
    for (const item of items ?? [])
      if (item.kind === 'text')
        texts.set(item.turnId, [...(texts.get(item.turnId) ?? []), item.text])
    return new Map([...texts].map(([turnId, parts]) => [turnId, parts.join('\n\n')]))
  }, [items])
  const draftKey = `chat-draft:${workspaceId}:${paneId}`
  const [selection, setSelection] = useState<AgentModel>()
  const [reasoning, setReasoning] = useState('')
  const [accessSelection, setAccessSelection] = useState<AgentAccessMode>()
  const [error, setError] = useState<string | null>(null)
  const catalogModels = catalog.data?.models
  if (
    selection &&
    catalogModels &&
    !catalogModels.some((model) => model.key === selection.key && model.available)
  )
    setSelection(undefined)
  const accessMode = accessSelection ?? session?.accessMode ?? 'full'
  const resolved = useMemo(
    () => resolveNewAgentModel(catalogModels ?? [], agentModelDefaults, lastAgent),
    [catalogModels, agentModelDefaults, lastAgent]
  )
  const selected = selection ?? session?.model ?? resolved
  const inFlight = useRef(false)
  const pendingSend = useRef<{ id: string; text: string; key?: string } | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const scrolling = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ComposerEditorHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Confirmed empty only after the section/session query has resolved.
  const empty = !loading && !session?.items.length
  const wasEmpty = useRef(empty)
  const dockHydrated = useRef(false)
  const imageRejection = useCallback(
    (): string | null =>
      selected?.modalities && !selected.modalities.includes('image')
        ? `${selected.label} does not accept images. Remove them or choose another model.`
        : null,
    [selected]
  )
  const {
    draft,
    initialText,
    dragging,
    attachFiles,
    remove,
    clear,
    onDocument,
    readDraft,
    dropHandlers
  } = useComposerDraft({
    storageKey: draftKey,
    editorRef,
    canAttach: imageRejection,
    onError: setError
  })
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
  const steer = useCallback(
    (commandId: string): void => {
      void execute({ action: 'steer', sessionId: session?.id, commandId })
    },
    [execute, session?.id]
  )
  const dequeue = useCallback(
    (commandId: string): void => {
      void execute({ action: 'dequeue', sessionId: session?.id, commandId })
    },
    [execute, session?.id]
  )
  useLayoutEffect(() => {
    if (stick.current && scrolling.current)
      scrolling.current.scrollTop = scrolling.current.scrollHeight
  }, [session?.sequence, session?.error, error, view.error])
  useLayoutEffect(() => {
    // Wait until the query confirms empty vs conversation — never center or animate on load.
    if (loading) return
    const view = viewRef.current
    const transcript = scrolling.current
    const input = composer.current
    if (!view || !transcript || !input) return
    const moving = dockHydrated.current && wasEmpty.current !== empty
    dockHydrated.current = true
    wasEmpty.current = empty
    const syncDock = (): void => {
      if (empty) {
        transcript.style.paddingBottom = ''
        transcript.style.scrollPaddingBottom = ''
        input.style.right = ''
        // Center on the form only — empty hero is absolutely positioned off-flow above it.
        const form = input.querySelector('form.chat-composer-shell')
        const shell = input.querySelector('[data-testid="chat-composer-shell"]')
        const formHeight = form instanceof HTMLElement ? form.offsetHeight : input.offsetHeight
        const padHost = shell?.parentElement ?? form?.parentElement
        const padBottom = padHost
          ? Number.parseFloat(getComputedStyle(padHost).paddingBottom) || 0
          : 0
        const offset = Math.max(0, view.clientHeight / 2 - formHeight / 2 - padBottom)
        input.style.transform = `translateY(-${offset}px)`
        return
      }
      input.style.transform = 'translateY(0)'
    }
    if (empty) {
      input.dataset.motion = moving ? 'on' : 'off'
      syncDock()
      const observer = new ResizeObserver(syncDock)
      observer.observe(view)
      observer.observe(input)
      const form = input.querySelector('form.chat-composer-shell')
      if (form instanceof HTMLElement) observer.observe(form)
      // Do not clear transform here — clearing would snap before the dock animation runs.
      return () => observer.disconnect()
    }
    // WAAPI keeps the center→bottom motion intact across the React commit that docks the shell.
    const from = getComputedStyle(input).transform
    input.dataset.motion = moving ? 'on' : 'off'
    input.style.transform = 'translateY(0)'
    let anim: Animation | undefined
    if (moving && from && from !== 'none') {
      anim = input.animate([{ transform: from }, { transform: 'translateY(0px)' }], {
        duration: 700,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards'
      })
    }
    const stopLayout = observeChatLayout(transcript, input, stick)
    return () => {
      anim?.cancel()
      stopLayout()
    }
  }, [empty, loading])
  const send = async (): Promise<void> => {
    if (inFlight.current) return
    const message = readDraft()
    if (!message.text.trim()) {
      setError('Write a message first.')
      return
    }
    const rejection = message.attachments.length ? imageRejection() : null
    if (rejection) {
      setError(rejection)
      return
    }
    if (!selected) {
      setError('Choose an available model first.')
      return
    }
    const fingerprint = [message.text, ...message.attachments.map((a) => a.id)].join('\u0000')
    if (
      !pendingSend.current ||
      pendingSend.current.text !== fingerprint ||
      pendingSend.current.key !== selected.key
    )
      pendingSend.current = { id: crypto.randomUUID(), text: fingerprint, key: selected.key }
    const isFirstMessage = !session
    const promptLabel = message.text.trim()
    stick.current = true
    if (
      await execute({
        action: 'send',
        commandId: pendingSend.current.id,
        sessionId: session?.id,
        text: message.text,
        ...(message.attachments.length ? { attachments: message.attachments } : {}),
        model: selected,
        reasoning: reasoning || undefined,
        accessMode
      })
    ) {
      if (isFirstMessage)
        void window.cerebro.layoutCommand({
          target: 'tab',
          action: 'rename',
          workspaceId,
          paneId,
          label: promptLabel
        })
      if (!lastAgent || lastAgent.harness === selected.harness) onRememberAgent?.(selected)
      clear()
      pendingSend.current = null
    }
  }
  const alertText = error ?? session?.error ?? (view.error ? String(view.error) : null)
  const starsWanted = agentBackground === 'stars' && empty
  const [starPhase, setStarPhase] = useState<'on' | 'out' | 'off'>('off')
  if (starsWanted && starPhase !== 'on') setStarPhase('on')
  else if (!starsWanted && starPhase === 'on') setStarPhase('out')
  useEffect(() => {
    if (starPhase !== 'out') return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timeout = window.setTimeout(() => setStarPhase('off'), reduce ? 0 : 480)
    return () => window.clearTimeout(timeout)
  }, [starPhase])
  return (
    <div
      ref={viewRef}
      className="chat-scrollbars relative z-0 flex h-full min-w-0 flex-col bg-background text-foreground"
      data-testid="chat-view"
      data-agent-background={agentBackground}
      data-loading={loading || undefined}
    >
      {starPhase !== 'off' ? (
        <StarsBackground
          aria-hidden="true"
          data-testid="chat-stars"
          data-visible={starPhase === 'on' ? 'true' : 'false'}
          pointerEvents={false}
          className="chat-stars pointer-events-none absolute inset-0 -z-10"
        />
      ) : null}
      {loading ? (
        <div
          data-testid="chat-loading"
          role="status"
          className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground"
        >
          Loading…
        </div>
      ) : (
        <>
          <div
            ref={scrolling}
            onScroll={() => {
              const node = scrolling.current
              if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
            }}
            className={cn('min-h-0 flex-1 overflow-y-auto px-5 pt-5', empty ? 'pb-5' : 'pb-40')}
            data-testid="chat-transcript"
            aria-label="Conversation"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {session?.items.length
                ? session.items.map((item, index) => (
                    <Fragment key={item.id}>
                      <ChatItem
                        item={item}
                        onReply={reply}
                        workspaceId={workspaceId}
                        sessionId={session.id}
                        streaming={busy && index === session.items.length - 1}
                      />
                      {item.kind !== 'user' &&
                      session.items[index + 1]?.turnId !== item.turnId &&
                      (item.turnId !== session.turnId || !busy) ? (
                        <div
                          role="separator"
                          aria-label="End of response"
                          className="flex items-center gap-3 py-2 text-xs text-muted-foreground"
                        >
                          <span className="h-px flex-1 bg-border" />
                          <ChatTurnActions
                            workspaceId={workspaceId}
                            paneId={paneId}
                            repositoryId={session.repositoryId}
                            sessionId={session.id}
                            turnId={item.turnId}
                            text={turnTexts.get(item.turnId) ?? ''}
                            forkCapability={catalog.data?.capabilities[session.model.harness]?.fork}
                          />
                          <span>End of response</span>
                          <span className="h-px flex-1 bg-border" />
                        </div>
                      ) : null}
                    </Fragment>
                  ))
                : null}
              {session?.status === 'running' ? (
                <div role="status" className="text-sm text-muted-foreground">
                  <span className="chat-working">Working…</span>
                </div>
              ) : null}
              {session && session.status !== 'running' ? (
                <div
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                  role="status"
                >
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
              {!empty && alertText ? (
                <p
                  role="alert"
                  className="whitespace-pre-wrap break-words text-xs text-destructive"
                >
                  {alertText}
                </p>
              ) : null}
            </div>
          </div>
          <div
            ref={composer}
            data-testid="chat-composer"
            data-dock={empty ? 'center' : 'bottom'}
            className="chat-composer-dock pointer-events-none"
          >
            {!empty ? (
              <div
                aria-hidden="true"
                data-testid="chat-list-fade"
                className="h-10 bg-gradient-to-t from-background via-background/80 to-transparent"
              />
            ) : null}
            <div className={cn('relative px-5', empty ? 'pb-0' : 'bg-background pb-4')}>
              {session ? (
                <div className={`mx-auto max-w-3xl ${visible ? 'pointer-events-auto' : ''}`}>
                  <ChatQueue session={session} onSteer={steer} onDequeue={dequeue} />
                </div>
              ) : null}
              <div
                className={`chat-composer-glow-wrap relative mx-auto max-w-3xl ${visible ? 'pointer-events-auto' : ''}`}
                data-testid="chat-composer-shell"
              >
                <div
                  className="chat-composer-empty"
                  data-testid="chat-empty-hero"
                  aria-hidden={empty ? undefined : true}
                >
                  <MessageSquare className="size-7 text-muted-foreground" />
                  <h2 className="text-lg font-medium">What would you like to build?</h2>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Work with Claude Code, Codex, or Pi in this workspace.
                  </p>
                </div>
                {agentBackground === 'glow' ? (
                  <div
                    className="chat-composer-glow"
                    aria-hidden="true"
                    data-testid="chat-composer-glow"
                  />
                ) : null}
                <form
                  className="chat-composer-shell relative rounded-2xl border bg-background p-2 shadow-lg"
                  data-dragging={dragging || undefined}
                  onSubmit={(e) => {
                    e.preventDefault()
                    void send()
                  }}
                  {...dropHandlers}
                >
                  <DropOverlay visible={dragging} />
                  <AttachmentStrip attachments={draft.attachments} onRemove={remove} />
                  <ComposerEditor
                    ref={editorRef}
                    defaultText={initialText}
                    attachments={draft.attachments}
                    getAttachments={() => readDraft().attachments}
                    onDocument={onDocument}
                    vim={vimOptions}
                    onVimMode={setVimMode}
                    onAttachFiles={(files) => {
                      void attachFiles(files)
                    }}
                    onSubmit={() => {
                      void send()
                    }}
                  />
                  <input
                    ref={fileInput}
                    type="file"
                    accept={chatImageAccept}
                    multiple
                    hidden
                    data-testid="chat-image-input"
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])]
                      e.target.value = ''
                      void attachFiles(files)
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <ModelPicker
                        selected={selected}
                        onSelect={(model) => {
                          onRememberAgent?.(model)
                          if (session && session.model.harness !== model.harness) {
                            setError(
                              `Open a new Agent tab or pane to use ${harnessLabels[model.harness]}.`
                            )
                            return
                          }
                          setError(null)
                          setSelection(model)
                          setReasoning('')
                        }}
                      />
                    </div>
                    {composerVim && vimMode ? <VimModeBadge mode={vimMode} /> : null}
                    <ContextUsageRing usage={session?.contextUsage} effort={session?.reasoning} />
                    <select
                      aria-label="Access mode"
                      title={
                        selected?.harness === 'pi'
                          ? 'Pi: Edit and Read-only limit tools and disable extensions; shell commands require Full access. Changes apply to the next message.'
                          : 'Access for the next message. Edit allows file changes; Read-only uses the harness read or plan mode.'
                      }
                      value={accessMode}
                      onChange={(event) =>
                        setAccessSelection(event.target.value as AgentAccessMode)
                      }
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
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Attach image"
                      title="Attach image (or drop / paste one)"
                      onClick={() => fileInput.current?.click()}
                    >
                      <ImagePlus className="size-4" />
                    </Button>
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
                </form>
              </div>
              {empty && alertText ? (
                <p
                  role="alert"
                  className="mx-auto mt-3 max-w-3xl whitespace-pre-wrap break-words text-xs text-destructive"
                >
                  {alertText}
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
