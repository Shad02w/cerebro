import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import '@xterm/xterm/css/xterm.css'
import '@/assets/terminal.css'
import { DEFAULT_TERMINAL_FONT_SIZE, TERMINAL_FONT_FAMILY_AUTO } from '@shared/types'
import { resolveTerminalFontFamily } from '@/lib/terminal-font'
import { useKeybindHandler } from '@/keybinds'
import { TerminalTabBar, type TerminalTab } from '@/components/terminal-tab-bar'

const TERMINAL_THEME = {
  background: '#0a0a0a',
  foreground: '#fafafa',
  cursor: '#fafafa',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#ffffff40',
  black: '#0a0a0a',
  brightBlack: '#737373',
  white: '#fafafa',
  brightWhite: '#ffffff'
} as const

type TerminalSessionProps = {
  workspaceId: number
  tabId: number
  active: boolean
  fontSize: number
  fontFamilyPreference: string
  onProcessExit: (tabId: number) => void
}

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

function fitSession(
  terminal: Terminal,
  fitAddon: FitAddon,
  sessionId: number | null,
  exited: boolean
): void {
  fitAddon.fit()
  if (sessionId != null && !exited) {
    void window.cerebro.resizePty(
      sessionId,
      Math.max(2, terminal.cols),
      Math.max(1, terminal.rows)
    )
  }
}

function TerminalSession({
  workspaceId,
  tabId,
  active,
  fontSize,
  fontFamilyPreference,
  onProcessExit
}: TerminalSessionProps): React.JSX.Element {
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

  onProcessExitRef.current = onProcessExit

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
          theme: TERMINAL_THEME,
          fontFamily
        })
        terminal.loadAddon(fitAddon)
        terminal.open(hostRef.current)
        try {
          terminal.loadAddon(new CanvasAddon())
        } catch {
          // Canvas renderer is optional; xterm's default renderer still works.
        }
        fitAddon.fit()
        hostRef.current.dataset.terminalFont = fontFamily.replaceAll('"', '')
        hostRef.current.dataset.terminalFontSize = String(fontSize)

        terminal.onData((data) => {
          const sessionId = sessionIdRef.current
          if (exitedRef.current || sessionId == null) return
          void window.cerebro.writePty(sessionId, data)
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
          onProcessExitRef.current(tabId)
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
  }, [workspaceId, tabId])

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
      fitAddon.fit()
      if (host) {
        host.dataset.terminalFont = resolvedFamily.replaceAll('"', '')
        host.dataset.terminalFontSize = String(fontSize)
      }

      const sessionId = sessionIdRef.current
      if (sessionId != null && !exitedRef.current) {
        void window.cerebro.resizePty(sessionId, terminalRef.current.cols, terminalRef.current.rows)
      }
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

    const observer = new ResizeObserver(() => {
      const terminal = terminalRef.current
      const fitAddon = fitAddonRef.current
      if (!terminal || !fitAddon) return
      fitSession(terminal, fitAddon, sessionIdRef.current, exitedRef.current)
    })

    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      data-terminal-workspace-id={workspaceId}
      data-terminal-tab-id={tabId}
      data-terminal-active={active ? 'true' : 'false'}
      className="absolute inset-0"
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
        zIndex: active ? 1 : 0
      }}
    >
      <div ref={hostRef} className="terminal-host" />
      {error ? (
        <div className="absolute inset-x-0 bottom-0 bg-destructive/90 px-3 py-2 text-xs text-destructive-foreground">
          {error}
        </div>
      ) : null}
    </div>
  )
}

type WorkspaceTabsState = {
  tabs: TerminalTab[]
  activeTabId: number | null
  nextLabel: number
}

let nextTabId = 1

function createTab(labelNumber: number): TerminalTab {
  const id = nextTabId
  nextTabId += 1
  return { id, label: `Terminal ${labelNumber}` }
}

function createWorkspaceTabs(): WorkspaceTabsState {
  const tab = createTab(1)
  return { tabs: [tab], activeTabId: tab.id, nextLabel: 2 }
}

function closeTabInWorkspace(workspace: WorkspaceTabsState, tabId: number): WorkspaceTabsState {
  const index = workspace.tabs.findIndex((tab) => tab.id === tabId)
  if (index < 0) return workspace

  const tabs = workspace.tabs.filter((tab) => tab.id !== tabId)
  if (workspace.activeTabId !== tabId) {
    return { ...workspace, tabs }
  }

  const next = tabs[index] ?? tabs[index - 1] ?? null
  return { ...workspace, tabs, activeTabId: next?.id ?? null }
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
  activeWorkspaceId: number | null
  fontSize: number | null
  fontFamily: string | null
  onSelectWorkspace: (workspaceId: number) => void
}

export function TerminalStack({
  activeWorkspaceId,
  fontSize,
  fontFamily,
  onSelectWorkspace
}: TerminalStackProps): React.JSX.Element {
  const [byWorkspace, setByWorkspace] = useState<Record<number, WorkspaceTabsState>>({})
  const resolvedFontSize = fontSize ?? DEFAULT_TERMINAL_FONT_SIZE
  const resolvedFontFamily = fontFamily ?? TERMINAL_FONT_FAMILY_AUTO

  const activeWorkspace =
    activeWorkspaceId != null ? (byWorkspace[activeWorkspaceId] ?? null) : null
  const tabs = activeWorkspace?.tabs ?? []
  const activeTabId = activeWorkspace?.activeTabId ?? null

  const selectTab = (tabId: number): void => {
    if (activeWorkspaceId == null) return
    setByWorkspace((current) => {
      const workspace = current[activeWorkspaceId]
      if (!workspace) return current
      return {
        ...current,
        [activeWorkspaceId]: { ...workspace, activeTabId: tabId }
      }
    })
  }

  const closeTab = (workspaceId: number, tabId: number): void => {
    setByWorkspace((current) => {
      const workspace = current[workspaceId]
      if (!workspace) return current
      return {
        ...current,
        [workspaceId]: closeTabInWorkspace(workspace, tabId)
      }
    })
  }

  useKeybindHandler('closeTab', () => {
    if (activeWorkspaceId == null || activeTabId == null) return false
    closeTab(activeWorkspaceId, activeTabId)
    return true
  })

  const addTab = (workspaceId: number): void => {
    setByWorkspace((current) => {
      const workspace = current[workspaceId]
      if (!workspace) {
        return { ...current, [workspaceId]: createWorkspaceTabs() }
      }
      const tab = createTab(workspace.nextLabel)
      return {
        ...current,
        [workspaceId]: {
          tabs: [...workspace.tabs, tab],
          activeTabId: tab.id,
          nextLabel: workspace.nextLabel + 1
        }
      }
    })
  }

  useKeybindHandler('newTerminal', () => {
    const targetId = focusedWorkspaceId() ?? activeWorkspaceId
    if (targetId == null) return false
    if (targetId !== activeWorkspaceId) {
      onSelectWorkspace(targetId)
    }
    addTab(targetId)
    return true
  })

  const sessions = Object.entries(byWorkspace).flatMap(([workspaceIdValue, workspace]) => {
    const workspaceId = Number(workspaceIdValue)
    return workspace.tabs.map((tab) => ({
      workspaceId,
      tab,
      active: workspaceId === activeWorkspaceId && tab.id === workspace.activeTabId
    }))
  })

  return (
    <div data-testid="terminal-stack" className="flex min-h-0 flex-1 flex-col">
      {activeWorkspaceId != null ? (
        <TerminalTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={selectTab}
          onClose={(tabId): void => closeTab(activeWorkspaceId, tabId)}
          onNewTab={(): void => {
            if (activeWorkspaceId != null) addTab(activeWorkspaceId)
          }}
        />
      ) : null}
      <div
        data-testid="terminal-sessions"
        className="relative min-h-0 flex-1 overflow-hidden bg-[#0a0a0a]"
      >
        {sessions.map(({ workspaceId, tab, active }) => (
          <TerminalSession
            key={tab.id}
            workspaceId={workspaceId}
            tabId={tab.id}
            active={active}
            fontSize={resolvedFontSize}
            fontFamilyPreference={resolvedFontFamily}
            onProcessExit={(exitedTabId): void => closeTab(workspaceId, exitedTabId)}
          />
        ))}
      </div>
    </div>
  )
}
