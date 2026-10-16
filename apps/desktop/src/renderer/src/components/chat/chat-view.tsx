import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, ImagePlus, MessageSquare, Square } from 'lucide-react'
import {
  resolveNewAgentModel,
  type AgentAccessMode,
  type AgentAnswer,
  type AgentModel,
  type AgentSkill,
  type ChatAttachment,
  type ChatAttachmentUpload,
  type ChatCommand,
  type ChatItem as ChatTranscriptItem,
  type ChatView as ChatSnapshot
} from '@cerebro/core'
import {
  DEFAULT_AGENT_BACKGROUND,
  type AgentBackground,
  type ComposerVimMode,
  type AgentModelDefaults,
  type LastAgent
} from '@shared/types'
import { AsciiField } from '@/components/ascii-field'
import { Button } from '@/components/ui/button'
import { SuccessToast } from '@/components/success-toast'
import { acceptLayout } from '@/lib/query-client'
import { StarsBackground } from '@/lib/stars-background'
import { defaultChatTabLabel, generatedTabLabel, promptTabLabel } from '@/lib/thread-tab-title'
import { cn } from '@/lib/utils'
import { ChatItem, WorkingGroup } from './chat-item'
import { transcriptEntries, transcriptTurnIds, watchedTurns, workingAnchorId } from './tool-groups'
import { TurnClock } from './turn-clock'
import { syncTurnClock } from './turn-durations'
import { WorkingFor } from './working-for'
import { ChatScrollEndButton } from './chat-scroll-end'
import { ChatTurnActions } from './chat-turn-actions'
import { ChatTurnRail } from './chat-turn-rail'
import { ChatQueue } from './chat-queue'
import {
  activeChatTurn,
  chatTurnAnchorItemIds,
  chatTurnSummaries,
  isTranscriptAtEnd
} from './chat-turns'
import { ChatSessionChips } from './chat-session-chips'
import { AttachmentStrip, DropOverlay } from './chat-composer-attachments'
import { ComposerEditor, type ComposerEditorHandle } from './composer-editor'
import { VimModeBadge } from './vim-mode-badge'
import type { Mode as VimMode } from 'vim-prosemirror'
import { chatImageAccept, useComposerDraft } from './use-composer-draft'
import { ModelPicker } from './model-picker'
import { ContextUsageRing } from './context-usage-ring'
import { messageToResend } from './model-switch'
import { agentSkillOptions, catalogOptions, harnessLabels } from './queries'
import { observeChatLayout } from './chat-layout'
import './chat-status.css'

const noSkills: readonly AgentSkill[] = []

function chatScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** Loads stored prompt images so a rewind can put the same chips back in the composer. */
async function rewindUploads(
  workspaceId: number,
  sessionId: string,
  attachments: ChatAttachment[] | undefined
): Promise<ChatAttachmentUpload[]> {
  if (!attachments?.length) return []
  return Promise.all(
    attachments.map(async (attachment) => {
      try {
        const content = await window.cerebro.chatAttachment(workspaceId, sessionId, attachment.id)
        return { ...attachment, data: content.data }
      } catch {
        return { ...attachment, data: '' }
      }
    })
  )
}

export function ChatView({
  workspaceId,
  paneId,
  visible = true,
  active = false,
  agentBackground = DEFAULT_AGENT_BACKGROUND,
  composerVim = false,
  composerVimMode = 'insert',
  agentModelDefaults,
  lastAgent = null,
  onRememberAgent,
  tabLabel = ''
}: {
  workspaceId: number
  paneId: number
  visible?: boolean
  active?: boolean
  agentBackground?: AgentBackground
  composerVim?: boolean
  composerVimMode?: ComposerVimMode
  agentModelDefaults: AgentModelDefaults
  lastAgent?: LastAgent | null
  onRememberAgent?: (model: AgentModel) => void
  /** Current content-tab label. A generated session title replaces the prompt label. */
  tabLabel?: string
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
  const firstPrompt = useMemo(
    () => items?.find((item) => item.kind === 'user' && item.text.trim())?.text ?? '',
    [items]
  )
  const seenTitle = useRef<string | null>(null)
  const renameTab = useCallback(
    (label: string) => {
      void window.cerebro
        .layoutCommand({
          target: 'tab',
          action: 'rename',
          workspaceId,
          paneId,
          label
        })
        .then((reply) => acceptLayout(reply.state))
        .catch(() => {})
    },
    [workspaceId, paneId]
  )
  useEffect(() => {
    const title = session?.title ?? ''
    const previous = seenTitle.current
    seenTitle.current = title || previous
    const next = generatedTabLabel({
      tabLabel,
      sessionTitle: title,
      prompt: firstPrompt,
      previousSessionTitle: previous
    })
    if (next) renameTab(next)
  }, [session?.title, tabLabel, firstPrompt, renameTab])
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
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null)
  const noticeId = useRef(0)
  const notify = useCallback((message: string) => {
    noticeId.current += 1
    setNotice({ id: noticeId.current, message })
  }, [])
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
  const skillQuery = useQuery(agentSkillOptions(workspaceId, paneId, selected?.harness))
  const skillList = skillQuery.data?.skills ?? noSkills
  const inFlight = useRef(false)
  const pendingSend = useRef<{ id: string; text: string; key?: string } | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const scrolling = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ComposerEditorHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Confirmed empty only after the section/session query has resolved.
  // A rewind back to the first prompt leaves no items, and the composer stays docked.
  const empty = !loading && !session?.items.length && !session?.rewind
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
    dragging,
    attachFiles,
    remove,
    clear,
    replace,
    onDocument,
    readDraft,
    dropHandlers
  } = useComposerDraft({
    storageKey: draftKey,
    editorRef,
    canAttach: imageRejection,
    onError: notify
  })
  const stick = useRef(true)
  const scrollingToEnd = useRef(false)
  const lastScrollTop = useRef(0)
  const [pinned, setPinned] = useState(true)
  const [activeTurn, setActiveTurn] = useState<string | null>(null)
  const busy = session?.status === 'running' || session?.status === 'waiting'
  const turns = useMemo(
    () => chatTurnSummaries(items ?? [], { busyTurnId: busy ? session?.turnId : undefined }),
    [items, busy, session?.turnId]
  )
  const turnAnchors = useMemo(() => new Set(chatTurnAnchorItemIds(items ?? [])), [items])
  const readScroll = useCallback(() => {
    const node = scrolling.current
    if (!node) return
    const near = isTranscriptAtEnd(node.scrollHeight, node.scrollTop, node.clientHeight)
    if (scrollingToEnd.current && node.scrollTop + 1 < lastScrollTop.current)
      scrollingToEnd.current = false
    lastScrollTop.current = node.scrollTop
    if (scrollingToEnd.current) {
      stick.current = true
      if (near) scrollingToEnd.current = false
      setPinned(true)
    } else {
      stick.current = near
      setPinned((current) => (current === near ? current : near))
    }
    const viewportTop = node.getBoundingClientRect().top
    const anchors: { turnId: string; top: number }[] = []
    for (const element of node.querySelectorAll<HTMLElement>('[data-turn-anchor]')) {
      const turnId = element.dataset.turnAnchor
      if (turnId) anchors.push({ turnId, top: element.getBoundingClientRect().top })
    }
    const next = activeChatTurn(anchors, viewportTop)
    setActiveTurn((current) => (current === next ? current : next))
  }, [])
  const scrollToEnd = useCallback(() => {
    const node = scrolling.current
    if (!node) return
    scrollingToEnd.current = true
    stick.current = true
    setPinned(true)
    lastScrollTop.current = node.scrollTop
    node.scrollTo({ top: node.scrollHeight, behavior: chatScrollBehavior() })
  }, [])
  const scrollToTurn = useCallback((turnId: string) => {
    const node = scrolling.current
    const anchor = node?.querySelector(`[data-turn-anchor="${CSS.escape(turnId)}"]`)
    if (!node || !(anchor instanceof HTMLElement)) return
    scrollingToEnd.current = false
    stick.current = false
    setPinned(false)
    setActiveTurn(turnId)
    const top =
      anchor.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - 12
    node.scrollTo({ top, behavior: chatScrollBehavior() })
  }, [])
  const { mutateAsync } = useMutation({
    mutationFn: async (command: ChatCommand) => {
      await client.cancelQueries({ queryKey })
      return window.cerebro.chatCommand(command)
    },
    onSuccess: (data) => {
      const incoming = data.session
      if (incoming && (incoming.status === 'running' || incoming.status === 'waiting'))
        syncTurnClock(
          true,
          watchedTurns(incoming.items, true, incoming.turnId),
          transcriptTurnIds(incoming.items, incoming.turnId)
        )
      let shown = incoming
      client.setQueryData<typeof data>(queryKey, (previous) => {
        if (
          previous?.session?.id === incoming?.id &&
          previous.session &&
          incoming &&
          previous.session.sequence > incoming.sequence
        ) {
          shown = previous.session
          return previous
        }
        shown = incoming
        return data
      })
      // The send result can be the running snapshot while a newer refetch is already idle.
      // Starting the clock here still records a duration for that turn.
      if (!shown || (shown.status !== 'running' && shown.status !== 'waiting'))
        syncTurnClock(false, [], transcriptTurnIds(shown?.items, shown?.turnId))
      void client.invalidateQueries({ queryKey: ['chat', workspaceId] })
    }
  })
  const execute = useCallback(
    async (command: Omit<ChatCommand, 'workspaceId' | 'paneId'>): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      try {
        await mutateAsync({ ...command, workspaceId, paneId })
        return true
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        inFlight.current = false
      }
    },
    [mutateAsync, notify, workspaceId, paneId]
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
  const applyingRewind = useRef(false)
  const filledRewind = useRef<string | null>(null)
  const readDraftRef = useRef(readDraft)
  const replaceRef = useRef(replace)
  useLayoutEffect(() => {
    readDraftRef.current = readDraft
    replaceRef.current = replace
  })
  const rewindTo = useCallback(
    async (item: ChatTranscriptItem, text: string): Promise<void> => {
      if (!session || item.kind !== 'user' || applyingRewind.current) return
      applyingRewind.current = true
      const displacedDraft = readDraft().text
      try {
        const uploads = await rewindUploads(workspaceId, session.id, item.attachments)
        const ok = await execute({
          action: 'rewind',
          sessionId: session.id,
          turnId: item.turnId,
          itemId: item.id,
          displacedDraft
        })
        if (!ok) return
        filledRewind.current = item.id
        replace(text, uploads)
        editorRef.current?.focus()
      } finally {
        applyingRewind.current = false
      }
    },
    [execute, readDraft, replace, session, workspaceId]
  )
  const undoRewind = useCallback(async (): Promise<void> => {
    const draft = session?.rewind?.displacedDraft ?? ''
    filledRewind.current = null
    if (await execute({ action: 'undo', sessionId: session?.id })) replace(draft)
  }, [execute, replace, session?.id, session?.rewind?.displacedDraft])
  useEffect(() => {
    const rewind = session?.rewind
    if (!rewind) {
      filledRewind.current = null
      return
    }
    if (applyingRewind.current || filledRewind.current === rewind.itemId) return
    const prompt = rewind.tail.find((item) => item.id === rewind.itemId)
    if (!prompt || prompt.kind !== 'user') return
    if (!session || readDraftRef.current().text.trim()) {
      filledRewind.current = rewind.itemId
      return
    }
    filledRewind.current = rewind.itemId
    const sessionId = session.id
    void (async () => {
      const uploads = await rewindUploads(workspaceId, sessionId, prompt.attachments)
      if (applyingRewind.current || filledRewind.current !== rewind.itemId) return
      if (readDraftRef.current().text.trim()) return
      replaceRef.current(prompt.text, uploads)
    })()
  }, [session, workspaceId])
  useLayoutEffect(() => {
    if (stick.current && scrolling.current)
      scrolling.current.scrollTop = scrolling.current.scrollHeight
    readScroll()
  }, [session?.sequence, session?.error, view.error, readScroll])
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
      notify('Write a message first.')
      return
    }
    const rejection = message.attachments.length ? imageRejection() : null
    if (rejection) {
      notify(rejection)
      return
    }
    if (!selected) {
      notify('Choose an available model first.')
      return
    }
    const fingerprint = [
      message.text,
      ...message.attachments.map((a) => a.id),
      ...message.skills.map((skill) => `${skill.name}\u0001${skill.path}`)
    ].join('\u0000')
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
        ...(message.skills.length ? { skills: message.skills } : {}),
        model: selected,
        reasoning: reasoning || undefined,
        accessMode
      })
    ) {
      if (isFirstMessage) {
        const cached = client.getQueryData<ChatSnapshot>(queryKey)
        const title = cached?.session?.title ?? ''
        renameTab(
          generatedTabLabel({
            tabLabel: defaultChatTabLabel,
            sessionTitle: title,
            prompt: promptLabel
          }) ?? promptTabLabel(promptLabel)
        )
      }
      if (!lastAgent || lastAgent.harness === selected.harness) onRememberAgent?.(selected)
      clear()
      pendingSend.current = null
    }
  }
  useEffect(() => {
    if (!active || loading) return
    // Leave keyboard focus on a tab the user reached by keyboard (e.g. after closing the
    // tab next to it); a pointer click on a tab still moves focus into the composer.
    if (document.activeElement?.matches('[role="tablist"] :focus-visible')) return
    editorRef.current?.focus()
  }, [active, loading])
  const alertText = session?.error ?? (view.error ? String(view.error) : null)
  const starsWanted = agentBackground === 'stars' && empty
  const asciiWanted = agentBackground === 'ascii' && empty
  const [starPhase, setStarPhase] = useState<'on' | 'out' | 'off'>('off')
  if (starsWanted && starPhase !== 'on') setStarPhase('on')
  else if (!starsWanted && starPhase === 'on') setStarPhase('out')
  const [asciiPhase, setAsciiPhase] = useState<'on' | 'out' | 'off'>('off')
  if (asciiWanted && asciiPhase !== 'on') setAsciiPhase('on')
  else if (!asciiWanted && asciiPhase === 'on') setAsciiPhase('out')
  useEffect(() => {
    if (starPhase !== 'out' && asciiPhase !== 'out') return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timeout = window.setTimeout(
      () => {
        setStarPhase((phase) => (phase === 'out' ? 'off' : phase))
        setAsciiPhase((phase) => (phase === 'out' ? 'off' : phase))
      },
      reduce ? 0 : 480
    )
    return () => window.clearTimeout(timeout)
  }, [starPhase, asciiPhase])
  const transcript = session?.items.length ? session : null
  const knownTurnIds = transcriptTurnIds(transcript?.items, transcript?.turnId)
  const watchedTurnIds = watchedTurns(transcript?.items, busy, transcript?.turnId)
  const liveTurnId = busy ? (transcript?.turnId ?? watchedTurnIds[0]) : undefined
  const entries = transcript ? transcriptEntries(transcript.items, liveTurnId) : []
  const workingAnchor =
    transcript?.status === 'running' ? workingAnchorId(entries, liveTurnId) : null
  return (
    <div
      ref={viewRef}
      className="relative z-0 flex h-full min-w-0 flex-col bg-background text-foreground"
      data-testid="chat-view"
      data-agent-background={agentBackground}
      data-loading={loading || undefined}
    >
      <SuccessToast
        toast={notice}
        onDismiss={() => setNotice(null)}
        testId="chat-notice-toast"
        tone="error"
      />
      {starPhase !== 'off' ? (
        <StarsBackground
          aria-hidden="true"
          data-testid="chat-stars"
          data-visible={starPhase === 'on' ? 'true' : 'false'}
          pointerEvents={false}
          className="chat-stars pointer-events-none absolute inset-0 -z-10"
        />
      ) : null}
      {asciiPhase !== 'off' ? (
        <AsciiField visible={asciiPhase === 'on'} className="chat-stars" />
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
            onScroll={readScroll}
            className={cn('min-h-0 flex-1 overflow-y-auto px-5 pt-5', empty ? 'pb-5' : 'pb-40')}
            data-testid="chat-transcript"
            aria-label="Conversation"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              <TurnClock active={busy} activeIds={watchedTurnIds} knownIds={knownTurnIds} />
              {transcript
                ? entries.map((entry, index, listed) => {
                    const first = entry.type === 'item' ? entry.item : entry.items[0]
                    const last =
                      entry.type === 'item' ? entry.item : entry.items[entry.items.length - 1]
                    const next = listed[index + 1]
                    const nextTurn = next
                      ? next.type === 'item'
                        ? next.item.turnId
                        : next.items[0]?.turnId
                      : undefined
                    const showWorking = first?.id === workingAnchor
                    const message =
                      entry.type === 'item' ? (
                        <ChatItem
                          item={entry.item}
                          onReply={reply}
                          onRewind={
                            entry.item.kind === 'user'
                              ? (text) => {
                                  void rewindTo(entry.item, text)
                                }
                              : undefined
                          }
                          workspaceId={workspaceId}
                          sessionId={transcript.id}
                          skills={skillList}
                          streaming={busy && entry.item.id === transcript.items.at(-1)?.id}
                        />
                      ) : (
                        <WorkingGroup items={entry.items} live={entry.live} />
                      )
                    return (
                      <Fragment key={first.id}>
                        {showWorking ? <WorkingFor /> : null}
                        {turnAnchors.has(first.id) ? (
                          <div
                            data-turn-anchor={first.turnId}
                            data-testid="chat-turn"
                            className="scroll-mt-3"
                          >
                            {message}
                          </div>
                        ) : (
                          message
                        )}
                        {last.kind !== 'user' &&
                        nextTurn !== last.turnId &&
                        (last.turnId !== transcript.turnId || !busy) ? (
                          <div
                            role="separator"
                            aria-label="End of response"
                            className="flex items-center gap-3 py-2 text-xs text-muted-foreground"
                          >
                            <span className="h-px flex-1 bg-border" />
                            <ChatTurnActions
                              workspaceId={workspaceId}
                              paneId={paneId}
                              repositoryId={transcript.repositoryId}
                              sessionId={transcript.id}
                              turnId={last.turnId}
                              text={turnTexts.get(last.turnId) ?? ''}
                              forkCapability={
                                catalog.data?.capabilities[transcript.model.harness]?.fork
                              }
                            />
                            <span>End of response</span>
                            <span className="h-px flex-1 bg-border" />
                          </div>
                        ) : null}
                      </Fragment>
                    )
                  })
                : null}
              {session?.rewind ? (
                <div
                  data-testid="chat-rewind-notice"
                  className="flex items-center gap-3 py-1 text-xs"
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="shrink-0 font-medium text-foreground"
                    data-testid="chat-rewind-undo"
                    onClick={() => {
                      void undoRewind()
                    }}
                  >
                    Undo
                  </Button>
                  <p className="text-muted-foreground">
                    {session.items.length
                      ? 'Rewound to this response. Changes were not restored.'
                      : 'Rewound to the start. Changes were not restored.'}
                  </p>
                </div>
              ) : null}
              {session?.status === 'running' && !workingAnchor ? <WorkingFor /> : null}
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
          <ChatTurnRail turns={turns} activeTurnId={activeTurn} onSelect={scrollToTurn} />
          <div
            ref={composer}
            data-testid="chat-composer"
            data-dock={empty ? 'center' : 'bottom'}
            className="chat-composer-dock pointer-events-none"
          >
            {!empty && !pinned ? <ChatScrollEndButton onClick={scrollToEnd} /> : null}
            {!empty ? (
              <div
                aria-hidden="true"
                data-testid="chat-list-fade"
                className="h-10 bg-gradient-to-t from-background via-background/80 to-transparent"
              />
            ) : null}
            <div
              data-testid="chat-composer-surface"
              className={cn('relative px-5', empty ? 'pb-0' : 'bg-background pb-4')}
            >
              {session ? (
                <div className={`mx-auto max-w-3xl ${visible ? 'pointer-events-auto' : ''}`}>
                  <ChatSessionChips session={session} />
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
                    key={selected?.harness ?? 'claude'}
                    ref={editorRef}
                    defaultText={draft.text}
                    attachments={draft.attachments}
                    skills={skillList}
                    workspaceId={workspaceId}
                    skillIssue={skillList.length ? '' : (skillQuery.data?.issue ?? '')}
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
                        sessionStarted={session != null}
                        onSelect={(model) => {
                          onRememberAgent?.(model)
                          if (session && session.model.harness !== model.harness) {
                            notify(
                              `Open a new Agent tab or pane to use ${harnessLabels[model.harness]}.`
                            )
                            return
                          }
                          const draft = readDraft()
                          const restored = messageToResend({
                            composerText: draft.text,
                            attachmentCount: draft.attachments.length,
                            current: selected,
                            next: model,
                            items: session?.items ?? []
                          })
                          setSelection(model)
                          setReasoning('')
                          if (restored) editorRef.current?.replaceText(restored)
                        }}
                      />
                    </div>
                    {composerVim && vimMode ? <VimModeBadge mode={vimMode} /> : null}
                    <ContextUsageRing
                      usage={session?.contextUsage}
                      harness={session?.model.harness}
                      modelLabel={session?.model.label}
                    />
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
