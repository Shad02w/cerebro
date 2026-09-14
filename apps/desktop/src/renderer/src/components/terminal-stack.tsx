import { ChatView } from '@/components/chat/chat-view'
import { TerminalOutput } from '../lib/terminal-output'
import { restoreTerminalContinuation } from '@shared/terminal-state'
import { forwardUserInputOnly } from '@/lib/terminal-input'
import type { PtyDataEvent, PtyExitEvent } from '@shared/types'
import type { LayoutState, LayoutCommand, PaneKind, SplitDirection } from '@cerebro/core'
import { PaneFrame, SplitHandle } from './pane-layout'
import { positionPanes } from '@/lib/pane-layout'
import { DEFAULT_TERMINAL_THEME, type TerminalThemeId } from '@shared/terminal-themes'
import { TERMINAL_PALETTES } from '@/lib/terminal-themes'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { acceptLayout, layoutOptions } from '@/lib/query-client'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import '@/assets/terminal.css'
import { DEFAULT_TERMINAL_FONT_SIZE, TERMINAL_FONT_FAMILY_AUTO } from '@shared/types'
import { resolveTerminalFontFamily } from '@/lib/terminal-font'
import { encodeExtendedKey } from '@/lib/terminal-keys'
import { useKeybindHandler } from '@/keybinds'
import { ChangesView } from '@/components/changes-view'
import { TerminalTabBar } from '@/components/terminal-tab-bar'
import { WorkspaceEmptyState } from '@/components/workspace-empty-state'

type TerminalSessionProps = {
  workspaceId: number
  tabId: number
  paneId: number
  visible: boolean
  active: boolean
  fontSize: number
  themeId: TerminalThemeId
  fontFamilyPreference: string
  onStartupReady?: (paneId: number) => void
}

/** Trailing wait after the last layout change (window resize, sidebar rail drag). */
const RESIZE_SETTLE_MS = 80

function waitForUsableSize(host: HTMLElement, isCancelled: () => boolean): Promise<void> {
  if (host.clientWidth >= 2 && host.clientHeight >= 2) return Promise.resolve()

  return new Promise((resolve) => {
    const finish = (): void => {
      observer.disconnect()
      window.clearTimeout(timeout)
      resolve()
    }
    const observer = new ResizeObserver(() => {
      if (isCancelled() || (host.clientWidth >= 2 && host.clientHeight >= 2)) finish()
    })
    observer.observe(host)
    const timeout = window.setTimeout(finish, 1000)
  })
}

function attachRenderer(terminal: Terminal, host: HTMLElement): void {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      webgl.dispose()
      host.dataset.terminalRenderer = 'dom'
    })
    terminal.loadAddon(webgl)
    host.dataset.terminalRenderer = 'webgl'
  } catch {
    host.dataset.terminalRenderer = 'dom'
  }
}

function proposedGrid(fitAddon: FitAddon): { cols: number; rows: number } | null {
  const proposed = fitAddon.proposeDimensions()
  if (!proposed || Number.isNaN(proposed.cols) || Number.isNaN(proposed.rows)) return null
  return {
    cols: Math.max(2, proposed.cols),
    rows: Math.max(1, proposed.rows)
  }
}

function fitSession(
  terminal: Terminal,
  fitAddon: FitAddon,
  sessionId: number | null,
  exited: boolean
): void {
  if (!terminal.element?.clientWidth || !terminal.element.clientHeight) return
  const grid = proposedGrid(fitAddon)
  if (!grid) return
  if (terminal.cols === grid.cols && terminal.rows === grid.rows) return

  // FitAddon.fit() calls renderService.clear() before resize, which blanks the
  // canvas for a frame. Resize without that wipe; skip PTY SIGWINCH when the
  // cell grid did not change.
  terminal.resize(grid.cols, grid.rows)
  if (sessionId != null && !exited) {
    void window.cerebro.resizePty(sessionId, grid.cols, grid.rows).catch(() => {})
  }
}

function TerminalNotices({
  status,
  previousScreen,
  error,
  onRestart
}: {
  status: string
  previousScreen?: string
  error: string | null
  onRestart: () => void
}): React.JSX.Element {
  return (
    <>
      {status === 'connecting' ? (
        <div className="absolute top-2 right-2 z-20 rounded bg-background px-2 py-1 text-xs text-muted-foreground">
          Connecting…
        </div>
      ) : null}
      {status === 'exited' ||
      status === 'failed' ||
      status === 'interrupted' ||
      status === 'stopped' ? (
        <div className="absolute right-2 bottom-2 z-20 flex items-center gap-2 rounded bg-background p-2 text-xs">
          <span>
            {status === 'exited'
              ? 'Shell exited'
              : status === 'stopped'
                ? 'Terminal server stopped'
                : status === 'interrupted'
                  ? 'Shell stopped'
                  : 'Shell failed to start'}
          </span>
          <button type="button" className="underline" onClick={onRestart}>
            Restart
          </button>
        </div>
      ) : null}
      {previousScreen ? (
        <details className="absolute top-2 left-2 z-20 max-h-64 max-w-full overflow-auto bg-background p-2 text-xs">
          <summary>Previous interrupted screen</summary>
          <pre>
            {/* VT escape codes are intentionally removed from this read-only text view. */}
            {previousScreen.replace(
              // eslint-disable-next-line no-control-regex
              /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g,
              ''
            )}
          </pre>
        </details>
      ) : null}
      {error ? (
        <div className="absolute inset-x-0 bottom-0 bg-destructive/90 px-3 py-2 text-xs text-destructive-foreground">
          {error}
        </div>
      ) : null}
    </>
  )
}

function useTerminalAppearance(
  {
    terminalRef,
    fitAddonRef,
    hostRef,
    sessionIdRef,
    exitedRef
  }: {
    terminalRef: RefObject<Terminal | null>
    fitAddonRef: RefObject<FitAddon | null>
    hostRef: RefObject<HTMLDivElement | null>
    sessionIdRef: RefObject<number | null>
    exitedRef: RefObject<boolean>
  },
  fontSize: number,
  fontFamilyPreference: string,
  themeId: TerminalThemeId,
  ready: boolean
): void {
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    const theme = TERMINAL_PALETTES[themeId]
    const current = terminal.options.theme ?? {}
    // Applying the same theme after snapshot replay erases restored OSC colors.
    if (
      Object.keys(current).length !== Object.keys(theme).length ||
      Object.entries(theme).some(([key, value]) => current[key as keyof typeof current] !== value)
    ) {
      terminal.options.theme = { ...theme }
    }
  }, [terminalRef, themeId, ready])
  useEffect(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const host = hostRef.current
    if (!terminal || !fitAddon) return

    let cancelled = false

    void (async () => {
      const resolvedFamily = await resolveTerminalFontFamily(fontFamilyPreference)
      if (cancelled || !terminalRef.current) return

      terminalRef.current.options.fontSize = fontSize
      terminalRef.current.options.fontFamily = resolvedFamily
      if (host) {
        host.dataset.terminalFont = resolvedFamily.replaceAll('"', '')
        host.dataset.terminalFontSize = String(fontSize)
      }
      fitSession(terminalRef.current, fitAddon, sessionIdRef.current, exitedRef.current)
    })()

    return () => {
      cancelled = true
    }
  }, [
    terminalRef,
    fitAddonRef,
    hostRef,
    sessionIdRef,
    exitedRef,
    fontSize,
    fontFamilyPreference,
    ready
  ])
}

function TerminalSession({
  workspaceId,
  tabId,
  paneId,
  visible,
  active,
  fontSize,
  fontFamilyPreference,
  themeId,
  onStartupReady
}: TerminalSessionProps): React.JSX.Element {
  const themeRef = useRef(themeId)
  useLayoutEffect(() => {
    themeRef.current = themeId
  }, [themeId])
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<number | null>(null)
  const exitedRef = useRef(false)
  const removeDataListenerRef = useRef<(() => void) | null>(null)
  const removeExitListenerRef = useRef<(() => void) | null>(null)
  const restarting = useRef(false)
  const [status, setStatus] = useState('connecting')
  const [generation, setGeneration] = useState(0)
  const [previousScreen, setPreviousScreen] = useState<string | undefined>()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    // Failed/exited panes have a visible recovery notice; never strand the splash.
    if (ready || error) onStartupReady?.(paneId)
  }, [ready, error, paneId, onStartupReady])
  useTerminalAppearance(
    { terminalRef, fitAddonRef, hostRef, sessionIdRef, exitedRef },
    fontSize,
    fontFamilyPreference,
    themeId,
    ready
  )
  useEffect(() => {
    if (status !== 'disconnected') return
    const timer = setTimeout(() => {
      setStatus('connecting')
      setGeneration((value) => value + 1)
    }, 750)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let terminal: Terminal | undefined
    let sequence = -1
    let initializing = true
    const buffered: PtyDataEvent[] = []
    const bufferedStatuses: PtyExitEvent[] = []

    let output: TerminalOutput | undefined
    const clearPtyListeners = (): void => {
      removeDataListenerRef.current?.()
      removeExitListenerRef.current?.()
      removeDataListenerRef.current = null
      removeExitListenerRef.current = null
    }

    void (async () => {
      try {
        const fontFamily = await resolveTerminalFontFamily(fontFamilyPreference)
        if (cancelled || !hostRef.current) return

        await waitForUsableSize(hostRef.current, () => cancelled)
        if (cancelled || !hostRef.current) return

        const fitAddon = new FitAddon()
        terminal = new Terminal({
          convertEol: true,
          scrollback: 10000,
          cursorBlink: true,
          fontSize,
          lineHeight: 1.1,
          allowTransparency: false,
          minimumContrastRatio: 1,
          customGlyphs: true,
          reflowCursorLine: false,
          rescaleOverlappingGlyphs: true,
          theme: { ...TERMINAL_PALETTES[themeRef.current] },
          fontFamily
        })
        forwardUserInputOnly(terminal)
        terminal.loadAddon(fitAddon)
        terminal.open(hostRef.current)
        attachRenderer(terminal, hostRef.current)
        const initialGrid =
          hostRef.current.clientWidth && hostRef.current.clientHeight
            ? proposedGrid(fitAddon)
            : undefined
        if (initialGrid) terminal.resize(initialGrid.cols, initialGrid.rows)
        hostRef.current.dataset.terminalFont = fontFamily.replaceAll('"', '')
        hostRef.current.dataset.terminalFontSize = String(fontSize)

        const xterm = terminal
        xterm.onData((data) => {
          const sessionId = sessionIdRef.current
          if (exitedRef.current || sessionId == null) return
          void window.cerebro.writePty(sessionId, data).catch((error) => {
            if (!cancelled) setError(String(error))
          })
        })

        xterm.attachCustomKeyEventHandler((event) => {
          const sequence = encodeExtendedKey(event)
          if (sequence == null) return true
          event.preventDefault()
          xterm.input(sequence)
          return false
        })

        terminalRef.current = terminal
        fitAddonRef.current = fitAddon

        output = new TerminalOutput((data, callback) => terminal!.write(data, callback))
        const applyData = (event: PtyDataEvent): void => {
          if (initializing) {
            buffered.push(event)
            return
          }
          if (event.sessionId !== sessionIdRef.current || event.sequence <= sequence) return
          sequence = event.sequence
          if (event.cols !== terminal!.cols || event.rows !== terminal!.rows)
            terminal!.resize(event.cols, event.rows)
          output!.push(event.data, () => {
            if (!cancelled) window.cerebro.ackPty(event.sessionId, event.sequence)
          })
        }
        clearPtyListeners()
        removeDataListenerRef.current = window.cerebro.onPtyData(applyData)
        const applyStatus = (event: PtyExitEvent): void => {
          if (initializing) {
            bufferedStatuses.push(event)
            return
          }
          if (event.sessionId !== sessionIdRef.current) return
          const next = event.status ?? 'exited'
          setStatus(next)
          setError(event.error ?? null)
          exitedRef.current = next !== 'running'
        }
        removeExitListenerRef.current = window.cerebro.onPtyExit(applyStatus)
        const snapshot = await window.cerebro.openPty(workspaceId, paneId)
        if (cancelled) {
          void window.cerebro.killPty(snapshot.sessionId).catch(() => {})
          return
        }
        sessionIdRef.current = snapshot.sessionId
        hostRef.current!.dataset.terminalSessionId = String(snapshot.sessionId)
        sequence = snapshot.sequence
        exitedRef.current = snapshot.status !== 'running' || Boolean(snapshot.readOnly)
        terminal.options.disableStdin = Boolean(snapshot.readOnly)
        terminal.options.scrollback = snapshot.scrollback ?? 10000
        terminal.resize(snapshot.cols, snapshot.rows)
        await new Promise<void>((resolve) => terminal!.write(snapshot.data, resolve))
        if (cancelled) return
        if (snapshot.continuation) restoreTerminalContinuation(terminal, snapshot.continuation)
        initializing = false
        for (const event of buffered) applyData(event)
        buffered.length = 0
        setStatus(snapshot.status)
        setError(snapshot.error ?? null)
        setPreviousScreen(snapshot.previousScreen)
        if (!snapshot.readOnly)
          fitSession(terminal, fitAddon, snapshot.sessionId, exitedRef.current)

        for (const event of bufferedStatuses) applyStatus(event)
        bufferedStatuses.length = 0
        setReady(true)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to open terminal.')
          if (/mux|connect|server/i.test(String(err))) setStatus('disconnected')
        }
      }
    })()

    return () => {
      cancelled = true
      setReady(false)
      clearPtyListeners()
      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      if (sessionId != null) {
        void window.cerebro.killPty(sessionId).catch(() => {})
      }
      output?.dispose()
      terminal?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
    // Recreate only when the tab changes; font updates apply live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: font props handled in separate effect
  }, [workspaceId, paneId, generation])

  useLayoutEffect(() => {
    if (!active || !ready) return
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon) return

    const frame = window.requestAnimationFrame(() => {
      fitSession(terminal, fitAddon, sessionIdRef.current, exitedRef.current)
      terminal.refresh(0, Math.max(0, terminal.rows - 1))
      terminal.focus()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [active, ready, workspaceId, tabId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let frame = 0
    let settle = 0

    const runFit = (): void => {
      const terminal = terminalRef.current
      const fitAddon = fitAddonRef.current
      if (!terminal || !fitAddon) return
      fitSession(terminal, fitAddon, sessionIdRef.current, exitedRef.current)
    }

    const observer = new ResizeObserver(() => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        window.clearTimeout(settle)
        settle = window.setTimeout(runFit, RESIZE_SETTLE_MS)
      })
    })

    observer.observe(host)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settle)
    }
  }, [])

  return (
    <div
      data-terminal-workspace-id={workspaceId}
      data-terminal-tab-id={tabId}
      data-terminal-pane-id={paneId}
      data-terminal-status={status}
      data-terminal-active={active ? 'true' : 'false'}
      className="absolute inset-0"
      style={{
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
        zIndex: visible ? 1 : 0
      }}
    >
      <div
        ref={hostRef}
        className="terminal-host"
        data-terminal-theme={themeId}
        style={{ backgroundColor: TERMINAL_PALETTES[themeId].background ?? '#000000' }}
      />
      <TerminalNotices
        status={status}
        previousScreen={previousScreen}
        error={error}
        onRestart={() => {
          if (restarting.current) return
          restarting.current = true
          void window.cerebro
            .restartPty(workspaceId, paneId)
            .then(() => setGeneration((value) => value + 1))
            .catch((error) => setError(String(error)))
            .finally(() => {
              restarting.current = false
            })
        }}
      />
    </div>
  )
}

function focusedWorkspaceId(): number | null {
  const el = document.activeElement
  if (!(el instanceof Element)) return null
  const row = el.closest('[data-workspace-id]')
  if (!row) return null
  const raw = row.getAttribute('data-workspace-id')
  if (!raw) return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

type TerminalStackProps = {
  visible: boolean
  activeWorkspaceId: number | null
  fontSize: number | null
  themeId: TerminalThemeId | null
  fontFamily: string | null
  onSelectWorkspace: (workspaceId: number) => void
  onStartupReady?: () => void
}

const EMPTY_LAYOUT: LayoutState = { revision: -1, workspaces: {} }

export function TerminalStack({
  visible,
  activeWorkspaceId,
  fontSize,
  fontFamily,
  themeId,
  onSelectWorkspace,
  onStartupReady
}: TerminalStackProps): React.JSX.Element {
  const layoutQuery = useQuery(layoutOptions)
  const layout = layoutQuery.data ?? EMPTY_LAYOUT
  const [readyPanes, setReadyPanes] = useState<Set<string>>(() => new Set())
  const paneReady = useCallback(
    (paneId: number) => {
      const key = `${layout.epoch}:${paneId}`
      setReadyPanes((current) => (current.has(key) ? current : new Set([...current, key])))
    },
    [layout.epoch]
  )
  const [error, setError] = useState<string | null>(null)
  useEffect(() => window.cerebro.onLayoutFocusWorkspace(onSelectWorkspace), [onSelectWorkspace])
  useEffect(() => {
    if (!onStartupReady || layout.revision < 0) return
    const workspace = activeWorkspaceId == null ? undefined : layout.workspaces[activeWorkspaceId]
    const tab = workspace?.tabs.find((tab) => tab.id === workspace.activeTabId)
    const terminals =
      visible && tab
        ? positionPanes(tab.root).panes.filter(({ pane }) => pane.kind === 'terminal')
        : []
    if (terminals.every(({ pane }) => readyPanes.has(`${layout.epoch}:${pane.id}`)))
      onStartupReady()
  }, [layout, activeWorkspaceId, visible, readyPanes, onStartupReady])
  const command = (request: LayoutCommand): void => {
    setError(null)
    void window.cerebro
      .layoutCommand(request)
      .then((reply) => acceptLayout(reply.state))
      .catch((error) => setError(String(error)))
  }
  const workspace = activeWorkspaceId == null ? undefined : layout.workspaces[activeWorkspaceId]
  const activeTabId = workspace?.activeTabId ?? null
  const addTab = (workspaceId: number, kind: PaneKind = 'terminal'): void =>
    command({ target: 'tab', action: 'create', workspaceId, kind })
  const openChanges = (workspaceId: number): void =>
    command({ target: 'tab', action: 'open-changes', workspaceId })
  useKeybindHandler('newTerminal', () => {
    if (!visible || onStartupReady) return false
    const target = focusedWorkspaceId() ?? activeWorkspaceId
    if (target == null) return false
    if (target !== activeWorkspaceId) onSelectWorkspace(target)
    addTab(target)
    return true
  })
  useKeybindHandler('newChat', () => {
    if (!visible || onStartupReady) return false
    const target = focusedWorkspaceId() ?? activeWorkspaceId
    if (target == null) return false
    if (target !== activeWorkspaceId) onSelectWorkspace(target)
    addTab(target, 'chat')
    return true
  })
  useKeybindHandler('openChanges', () => {
    if (!visible || onStartupReady) return false
    const target = focusedWorkspaceId() ?? activeWorkspaceId
    if (target == null) return false
    if (target !== activeWorkspaceId) onSelectWorkspace(target)
    openChanges(target)
    return true
  })
  useKeybindHandler('closeTab', () => {
    if (!visible || onStartupReady || activeWorkspaceId == null || activeTabId == null) return false
    command({ target: 'tab', action: 'close', workspaceId: activeWorkspaceId, tabId: activeTabId })
    return true
  })
  const addPane = (kind: PaneKind, direction: SplitDirection): void => {
    if (activeWorkspaceId == null || activeTabId == null) return
    command({
      target: 'pane',
      action: 'split',
      workspaceId: activeWorkspaceId,
      tabId: activeTabId,
      kind,
      direction
    })
  }
  return (
    <div data-testid="terminal-stack" className="flex min-h-0 flex-1 flex-col">
      {activeWorkspaceId != null ? (
        <TerminalTabBar
          tabs={workspace?.tabs ?? []}
          activeTabId={activeTabId}
          onSelect={(tabId) =>
            command({ target: 'tab', action: 'focus', workspaceId: activeWorkspaceId, tabId })
          }
          onClose={(tabId) =>
            command({ target: 'tab', action: 'close', workspaceId: activeWorkspaceId, tabId })
          }
          onReorder={(tabId, toIndex) =>
            command({
              target: 'tab',
              action: 'reorder',
              workspaceId: activeWorkspaceId,
              tabId,
              toIndex
            })
          }
          onNewTab={() => addTab(activeWorkspaceId)}
          onOpenChat={() => addTab(activeWorkspaceId, 'chat')}
          onOpenChanges={() => openChanges(activeWorkspaceId)}
          onAddPane={addPane}
        />
      ) : null}
      {error || layoutQuery.error ? (
        <div role="alert" className="bg-destructive/15 px-3 py-2 text-xs text-destructive">
          {error ?? layoutQuery.error?.message}
        </div>
      ) : null}
      <div
        data-testid="terminal-sessions"
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{
          backgroundColor:
            activeTabId == null
              ? '#000000'
              : (TERMINAL_PALETTES[themeId ?? DEFAULT_TERMINAL_THEME].background ?? '#000000')
        }}
      >
        {visible &&
        activeWorkspaceId != null &&
        layoutQuery.isSuccess &&
        !workspace?.tabs.length ? (
          <WorkspaceEmptyState
            onNewTerminal={() => addTab(activeWorkspaceId)}
            onOpenChat={() => addTab(activeWorkspaceId, 'chat')}
            onOpenChanges={() => openChanges(activeWorkspaceId)}
          />
        ) : null}
        {Object.entries(layout.workspaces).flatMap(([workspaceKey, workspace]) =>
          workspace.tabs.map((tab) => {
            const workspaceId = Number(workspaceKey)
            const shown =
              visible && workspaceId === activeWorkspaceId && tab.id === workspace.activeTabId
            const { panes, splits } = positionPanes(tab.root)
            // Keep Changes DOM and view state across tab switches. Terminal surfaces still
            // detach when hidden; their processes and output remain owned by the mux.
            if (!shown && !panes.some(({ pane }) => pane.kind !== 'terminal')) return null
            return (
              <div
                key={tab.id}
                className="absolute inset-0"
                data-testid="tab-panes"
                data-tab-id={tab.id}
                style={{
                  visibility: shown ? 'visible' : 'hidden',
                  pointerEvents: shown ? 'auto' : 'none'
                }}
                inert={!shown}
              >
                {panes.map(({ pane, rect }) => {
                  if (!shown && pane.kind === 'terminal') return null
                  const active = shown && tab.activePaneId === pane.id
                  const close = (): void =>
                    command({
                      target: 'pane',
                      action: 'close',
                      workspaceId,
                      tabId: tab.id,
                      paneId: pane.id
                    })
                  return (
                    <PaneFrame
                      key={pane.id}
                      pane={pane}
                      rect={rect}
                      visible={shown}
                      active={active}
                      multiple={panes.length > 1}
                      onFocus={() =>
                        command({
                          target: 'pane',
                          action: 'focus',
                          workspaceId,
                          tabId: tab.id,
                          paneId: pane.id
                        })
                      }
                      onClose={close}
                    >
                      {pane.kind === 'terminal' ? (
                        <TerminalSession
                          key={layout.epoch}
                          workspaceId={workspaceId}
                          tabId={tab.id}
                          paneId={pane.id}
                          visible={shown}
                          active={active && !onStartupReady}
                          onStartupReady={onStartupReady ? paneReady : undefined}
                          fontSize={fontSize ?? DEFAULT_TERMINAL_FONT_SIZE}
                          themeId={themeId ?? DEFAULT_TERMINAL_THEME}
                          fontFamilyPreference={fontFamily ?? TERMINAL_FONT_FAMILY_AUTO}
                        />
                      ) : pane.kind === 'chat' ? (
                        <ChatView workspaceId={workspaceId} paneId={pane.id} visible={shown} />
                      ) : pane.kind === 'changes' ? (
                        <ChangesView
                          workspaceId={workspaceId}
                          paneId={pane.id}
                          repositoryId={pane.repositoryId}
                          savedState={pane.state}
                          active={shown}
                        />
                      ) : (
                        <div className="p-4 text-sm text-muted-foreground">
                          Unsupported pane type: {pane.kind}
                        </div>
                      )}
                    </PaneFrame>
                  )
                })}
                {splits.map(({ split, rect }, index) => (
                  <SplitHandle
                    key={split.id}
                    split={split}
                    priority={splits.length - index + 1}
                    rect={rect}
                    onResize={(ratio) =>
                      command({
                        target: 'pane',
                        action: 'resize',
                        workspaceId,
                        tabId: tab.id,
                        splitId: split.id,
                        ratio
                      })
                    }
                  />
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
