import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import '@xterm/xterm/css/xterm.css'
import '@/assets/terminal.css'
import { DEFAULT_TERMINAL_FONT_SIZE, TERMINAL_FONT_FAMILY_AUTO } from '@shared/types'
import { resolveTerminalFontFamily } from '@/lib/terminal-font'

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
  active: boolean
  fontSize: number
  fontFamilyPreference: string
}

function TerminalSession({
  workspaceId,
  active,
  fontSize,
  fontFamilyPreference
}: TerminalSessionProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<number | null>(null)
  const exitedRef = useRef(false)
  const removeDataListenerRef = useRef<(() => void) | null>(null)
  const removeExitListenerRef = useRef<(() => void) | null>(null)
  const wirePtyRef = useRef<(() => Promise<void>) | null>(null)
  const [error, setError] = useState<string | null>(null)

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

    const attachRenderer = (term: Terminal): void => {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          webgl.dispose()
          term.loadAddon(new CanvasAddon())
        })
        term.loadAddon(webgl)
      } catch {
        term.loadAddon(new CanvasAddon())
      }
    }

    void (async () => {
      try {
        const fontFamily = await resolveTerminalFontFamily(fontFamilyPreference)
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
        attachRenderer(terminal)
        fitAddon.fit()
        hostRef.current.dataset.terminalFont = fontFamily.replaceAll('"', '')
        hostRef.current.dataset.terminalFontSize = String(fontSize)

        terminal.onData((data) => {
          const sessionId = sessionIdRef.current
          if (exitedRef.current || sessionId == null) return
          void window.cerebro.writePty(sessionId, data)
        })

        const wirePty = async (): Promise<void> => {
          if (!terminalRef.current || !fitAddonRef.current) return
          fitAddonRef.current.fit()
          const cols = Math.max(2, terminalRef.current.cols)
          const rows = Math.max(1, terminalRef.current.rows)
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
            terminalRef.current?.writeln(`\r\n[Process exited with code ${event.exitCode}]`)
          })
        }

        terminalRef.current = terminal
        fitAddonRef.current = fitAddon
        wirePtyRef.current = wirePty

        await wirePty()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to open terminal.')
        }
      }
    })()

    return () => {
      cancelled = true
      clearPtyListeners()
      wirePtyRef.current = null
      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      if (sessionId != null) {
        void window.cerebro.killPty(sessionId)
      }
      terminal?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
    // Recreate only when the workspace changes; font updates apply live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: font props handled in separate effect
  }, [workspaceId])

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

  useEffect(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!active || !terminal || !fitAddon) return

    const activate = async (): Promise<void> => {
      fitAddon.fit()
      terminal.refresh(0, Math.max(0, terminal.rows - 1))
      terminal.focus()

      if (exitedRef.current || sessionIdRef.current == null) {
        try {
          await wirePtyRef.current?.()
          setError(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to reopen terminal.')
        }
      } else {
        void window.cerebro.resizePty(sessionIdRef.current, terminal.cols, terminal.rows)
      }
    }

    void activate()
  }, [active, workspaceId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const observer = new ResizeObserver(() => {
      const terminal = terminalRef.current
      const fitAddon = fitAddonRef.current
      const sessionId = sessionIdRef.current
      if (!terminal || !fitAddon) return
      fitAddon.fit()
      if (sessionId != null && !exitedRef.current) {
        void window.cerebro.resizePty(sessionId, terminal.cols, terminal.rows)
      }
    })

    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      data-terminal-workspace-id={workspaceId}
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

type TerminalStackProps = {
  activeWorkspaceId: number | null
  fontSize: number | null
  fontFamily: string | null
}

export function TerminalStack({
  activeWorkspaceId,
  fontSize,
  fontFamily
}: TerminalStackProps): React.JSX.Element {
  const [openedIds, setOpenedIds] = useState<number[]>([])
  const resolvedFontSize = fontSize ?? DEFAULT_TERMINAL_FONT_SIZE
  const resolvedFontFamily = fontFamily ?? TERMINAL_FONT_FAMILY_AUTO

  if (activeWorkspaceId != null && !openedIds.includes(activeWorkspaceId)) {
    setOpenedIds([...openedIds, activeWorkspaceId])
  }

  return (
    <div
      data-testid="terminal-stack"
      className="relative min-h-0 flex-1 overflow-hidden bg-[#0a0a0a]"
    >
      {openedIds.map((workspaceId) => (
        <TerminalSession
          key={workspaceId}
          workspaceId={workspaceId}
          active={workspaceId === activeWorkspaceId}
          fontSize={resolvedFontSize}
          fontFamilyPreference={resolvedFontFamily}
        />
      ))}
    </div>
  )
}
