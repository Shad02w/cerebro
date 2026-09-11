import { KeybindContext, type KeybindContextValue, type KeybindHandler } from './context'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HotkeysProvider, matchesKeyboardEvent, parseHotkey } from '@tanstack/react-hotkeys'
import {
  KEYBIND_CATALOG,
  getKeybindAction,
  resolveKeybinds,
  type KeybindActionId,
  type KeybindOverrides,
  type NativeCommandId
} from '@shared/keybinds'

/** Ignore native closeWindow if we just closed a tab (React may flush mid-keydown). */
let lastCloseTabAt = 0
const CLOSE_TAB_NATIVE_GUARD_MS = 500

async function runNative(command: NativeCommandId): Promise<void> {
  await window.cerebro.runNativeCommand(command)
}

function invokeKeybind(id: KeybindActionId, handlers: Map<KeybindActionId, KeybindHandler>): void {
  const action = getKeybindAction(id)
  if (action.target === 'native') {
    if (action.nativeCommand) void runNative(action.nativeCommand)
    return
  }
  const handler = handlers.get(id)
  const handled = handler?.()
  if (handled === true) {
    if (id === 'closeTab') lastCloseTabAt = Date.now()
    return
  }
  if (
    id === 'closeTab' &&
    action.nativeCommand &&
    Date.now() - lastCloseTabAt < CLOSE_TAB_NATIVE_GUARD_MS
  ) {
    return
  }
  if (action.nativeCommand) void runNative(action.nativeCommand)
}

function KeybindRegistrar({
  bindings,
  recording,
  handlersRef
}: {
  bindings: Record<KeybindActionId, string>
  recording: boolean
  handlersRef: React.MutableRefObject<Map<KeybindActionId, KeybindHandler>>
}): null {
  const invoke = useCallback(
    (id: KeybindActionId): void => {
      invokeKeybind(id, handlersRef.current)
    },
    [handlersRef]
  )

  // Capture phase so chords still fire when xterm's textarea (or another widget)
  // stops bubbling. Bubble-phase listeners never see those events.
  useEffect(() => {
    if (recording) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return
      for (const action of KEYBIND_CATALOG) {
        if (!matchesKeyboardEvent(event, parseHotkey(bindings[action.id]))) continue
        event.preventDefault()
        event.stopPropagation()
        invoke(action.id)
        return
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return (): void => {
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [bindings, invoke, recording])

  return null
}

type KeybindProviderInnerProps = {
  overrides: KeybindOverrides | null | undefined
  children: ReactNode
}

function KeybindProviderInner({
  overrides,
  children
}: KeybindProviderInnerProps): React.JSX.Element {
  const bindings = useMemo(() => resolveKeybinds(overrides ?? undefined), [overrides])
  const [recording, setRecording] = useState(false)
  const handlersRef = useRef(new Map<KeybindActionId, KeybindHandler>())

  const registerHandler = useCallback(
    (id: KeybindActionId, handler: KeybindHandler): (() => void) => {
      handlersRef.current.set(id, handler)
      return () => {
        if (handlersRef.current.get(id) === handler) {
          handlersRef.current.delete(id)
        }
      }
    },
    []
  )

  const invokeAction = useCallback((id: KeybindActionId): void => {
    invokeKeybind(id, handlersRef.current)
  }, [])

  useEffect(() => {
    return window.cerebro.onMenuClose(() => {
      invokeAction('closeTab')
    })
  }, [invokeAction])

  const value = useMemo<KeybindContextValue>(
    () => ({
      bindings,
      recording,
      setRecording,
      registerHandler,
      invokeAction
    }),
    [bindings, recording, registerHandler, invokeAction]
  )

  return (
    <KeybindContext.Provider value={value}>
      <KeybindRegistrar bindings={bindings} recording={recording} handlersRef={handlersRef} />
      {children}
    </KeybindContext.Provider>
  )
}

type KeybindProviderProps = {
  overrides: KeybindOverrides | null | undefined
  children: ReactNode
}

export function KeybindProvider({ overrides, children }: KeybindProviderProps): React.JSX.Element {
  return (
    <HotkeysProvider
      defaultOptions={{
        hotkey: { preventDefault: true, ignoreInputs: false, requireReset: true }
      }}
    >
      <KeybindProviderInner overrides={overrides}>{children}</KeybindProviderInner>
    </HotkeysProvider>
  )
}
