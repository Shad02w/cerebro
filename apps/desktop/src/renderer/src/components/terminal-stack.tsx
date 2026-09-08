import type { LayoutState, LayoutCommand, PaneKind, SplitDirection } from '@cerebro/core'
import { PaneFrame, SplitHandle } from './pane-layout'
import { positionPanes } from '@/lib/pane-layout'
import { DEFAULT_TERMINAL_THEME, type TerminalThemeId } from '@shared/terminal-themes'
import { TERMINAL_PALETTES } from '@/lib/terminal-themes'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import '@/assets/terminal.css'
import { DEFAULT_TERMINAL_FONT_SIZE, TERMINAL_FONT_FAMILY_AUTO } from '@shared/types'
import { resolveTerminalFontFamily } from '@/lib/terminal-font'
import { encodeExtendedKey } from '@/lib/terminal-keys'
import { useKeybindHandler } from '@/keybinds'
import { ChangesView } from '@/components/changes-view'
import { TerminalTabBar } from '@/components/terminal-tab-bar'

type TerminalSessionProps = {
  workspaceId: number
  tabId: number
  paneId: number
  visible: boolean
  active: boolean
  fontSize: number
  themeId: TerminalThemeId
  fontFamilyPreference: string
  onProcessExit: (tabId: number) => void
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
  const attachCanvas = (): void => {
    try {
      terminal.loadAddon(new CanvasAddon())
      host.dataset.terminalRenderer = 'canvas'
    } catch {
      // Canvas is optional; xterm's default DOM renderer still works.
      host.dataset.terminalRenderer = 'dom'
    }
  }

  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      webgl.dispose()
      attachCanvas()
    })
    terminal.loadAddon(webgl)
    host.dataset.terminalRenderer = 'webgl'
  } catch {
    attachCanvas()
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
    void window.cerebro.resizePty(sessionId, grid.cols, grid.rows)
  }
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
  onProcessExit
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
  const onProcessExitRef = useRef(onProcessExit)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = { ...TERMINAL_PALETTES[themeId] }
    }
  }, [themeId, ready])

  useLayoutEffect(() => {
    onProcessExitRef.current = onProcessExit
  }, [onProcessExit])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let terminal: Terminal | undefined

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
          cursorBlink: true,
          fontSize,
          lineHeight: 1.1,
          allowTransparency: false,
          rescaleOverlappingGlyphs: true,
          theme: { ...TERMINAL_PALETTES[themeRef.current] },
          fontFamily
        })
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
          void window.cerebro.writePty(sessionId, data)
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

        const cols = Math.max(2, terminal.cols)
        const rows = Math.max(1, terminal.rows)
        const { sessionId } = await window.cerebro.openPty(workspaceId, cols, rows)
        if (cancelled) {
          void window.cerebro.killPty(sessionId)
          return
        }

        clearPtyListeners()
        sessionIdRef.current = sessionId
        exitedRef.current = false

        removeDataListenerRef.current = window.cerebro.onPtyData((event) => {
          if (event.sessionId !== sessionIdRef.current) return
          terminalRef.current?.write(event.data)
        })

        removeExitListenerRef.current = window.cerebro.onPtyExit((event) => {
          if (event.sessionId !== sessionIdRef.current) return
          exitedRef.current = true
          sessionIdRef.current = null
          onProcessExitRef.current(paneId)
        })

        setReady(true)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to open terminal.')
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
        void window.cerebro.killPty(sessionId)
      }
      terminal?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
    // Recreate only when the tab changes; font updates apply live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: font props handled in separate effect
  }, [workspaceId, paneId])

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
  }, [fontSize, fontFamilyPreference])

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
      {error ? (
        <div className="absolute inset-x-0 bottom-0 bg-destructive/90 px-3 py-2 text-xs text-destructive-foreground">
          {error}
        </div>
      ) : null}
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
}

export function TerminalStack({
  visible,
  activeWorkspaceId,
  fontSize,
  fontFamily,
  themeId,
  onSelectWorkspace
}: TerminalStackProps): React.JSX.Element {
  const [layout, setLayout] = useState<LayoutState>({ revision: -1, workspaces: {} })
  const [error, setError] = useState<string | null>(null)
  useEffect(() => window.cerebro.onLayoutFocusWorkspace(onSelectWorkspace), [onSelectWorkspace])
  const accept = (next: LayoutState): void =>
    setLayout((current) => (next.revision >= current.revision ? next : current))
  useEffect(() => {
    let cancelled = false
    const acceptInitial = (next: LayoutState): void => {
      if (!cancelled) accept(next)
    }
    const unsubscribe = window.cerebro.onLayoutChanged(acceptInitial)
    void window.cerebro
      .getLayout()
      .then(acceptInitial)
      .catch((error) => {
        if (!cancelled) setError(String(error))
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  const command = (request: LayoutCommand): void => {
    setError(null)
    void window.cerebro
      .layoutCommand(request)
      .then((reply) => accept(reply.state))
      .catch((error) => setError(String(error)))
  }
  const workspace = activeWorkspaceId == null ? undefined : layout.workspaces[activeWorkspaceId]
  const activeTabId = workspace?.activeTabId ?? null
  const addTab = (workspaceId: number, kind: PaneKind = 'terminal'): void =>
    command({ target: 'tab', action: 'create', workspaceId, kind })
  const openChanges = (workspaceId: number): void =>
    command({ target: 'tab', action: 'open-changes', workspaceId })
  useKeybindHandler('newTerminal', () => {
    if (!visible) return false
    const target = focusedWorkspaceId() ?? activeWorkspaceId
    if (target == null) return false
    if (target !== activeWorkspaceId) onSelectWorkspace(target)
    addTab(target)
    return true
  })
  useKeybindHandler('openChanges', () => {
    if (!visible) return false
    const target = focusedWorkspaceId() ?? activeWorkspaceId
    if (target == null) return false
    if (target !== activeWorkspaceId) onSelectWorkspace(target)
    openChanges(target)
    return true
  })
  useKeybindHandler('closeTab', () => {
    if (!visible || activeWorkspaceId == null || activeTabId == null) return false
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
          onOpenChanges={() => openChanges(activeWorkspaceId)}
          onAddPane={addPane}
        />
      ) : null}
      {error ? (
        <div role="alert" className="bg-destructive/15 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      <div
        data-testid="terminal-sessions"
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{
          backgroundColor:
            TERMINAL_PALETTES[themeId ?? DEFAULT_TERMINAL_THEME].background ?? '#000000'
        }}
      >
        {Object.entries(layout.workspaces).flatMap(([workspaceKey, workspace]) =>
          workspace.tabs.map((tab) => {
            const workspaceId = Number(workspaceKey)
            const shown =
              visible && workspaceId === activeWorkspaceId && tab.id === workspace.activeTabId
            const { panes, splits } = positionPanes(tab.root)
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
                          workspaceId={workspaceId}
                          tabId={tab.id}
                          paneId={pane.id}
                          visible={shown}
                          active={active}
                          fontSize={fontSize ?? DEFAULT_TERMINAL_FONT_SIZE}
                          themeId={themeId ?? DEFAULT_TERMINAL_THEME}
                          fontFamilyPreference={fontFamily ?? TERMINAL_FONT_FAMILY_AUTO}
                          onProcessExit={close}
                        />
                      ) : (
                        <ChangesView workspaceId={workspaceId} active={shown} />
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
