import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { HotkeysProvider, useHotkeys, type RegisterableHotkey } from '@tanstack/react-hotkeys'
import {
  KEYBIND_CATALOG,
  getKeybindAction,
  resolveKeybinds,
  type KeybindActionId,
  type KeybindOverrides,
  type NativeCommandId
} from '@shared/keybinds'

export type KeybindHandler = () => boolean | void

type KeybindContextValue = {
  bindings: Record<KeybindActionId, string>
  recording: boolean
  setRecording: (recording: boolean) => void
  registerHandler: (id: KeybindActionId, handler: KeybindHandler) => () => void
  invokeAction: (id: KeybindActionId) => void
}

const KeybindContext = createContext<KeybindContextValue | null>(null)

/** Ignore native closeWindow if we just closed a tab (React may flush mid-keydown). */
let lastCloseTabAt = 0
const CLOSE_TAB_NATIVE_GUARD_MS = 500

async function runNative(command: NativeCommandId): Promise<void> {
  await window.cerebro.runNativeCommand(command)
}

function invokeKeybind(
  id: KeybindActionId,
  handlers: Map<KeybindActionId, KeybindHandler>
): void {
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

  useHotkeys(
    KEYBIND_CATALOG.map((action) => ({
      hotkey: bindings[action.id] as RegisterableHotkey,
      callback: (): void => {
        invoke(action.id)
      },
      options: {
        enabled: !recording,
        preventDefault: true,
        ignoreInputs: false,
        requireReset: true
      }
    })),
    { preventDefault: true, ignoreInputs: false, enabled: !recording, requireReset: true }
  )

  return null
}

type KeybindProviderInnerProps = {
  overrides: KeybindOverrides | null | undefined
  children: ReactNode
}

function KeybindProviderInner({ overrides, children }: KeybindProviderInnerProps): React.JSX.Element {
  const bindings = useMemo(() => resolveKeybinds(overrides ?? undefined), [overrides])
  const [recording, setRecording] = useState(false)
  const handlersRef = useRef(new Map<KeybindActionId, KeybindHandler>())

  const registerHandler = useCallback((id: KeybindActionId, handler: KeybindHandler): (() => void) => {
    handlersRef.current.set(id, handler)
    return () => {
      if (handlersRef.current.get(id) === handler) {
        handlersRef.current.delete(id)
      }
    }
  }, [])

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

export function useKeybinds(): KeybindContextValue {
  const ctx = useContext(KeybindContext)
  if (!ctx) throw new Error('useKeybinds must be used within KeybindProvider.')
  return ctx
}

/** Register an app-level handler for a keybind action. Returns handled=true to skip native fallback. */
export function useKeybindHandler(id: KeybindActionId, handler: KeybindHandler): void {
  const { registerHandler } = useKeybinds()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    return registerHandler(id, () => handlerRef.current())
  }, [id, registerHandler])
}

export function useKeybindBinding(id: KeybindActionId): string {
  return useKeybinds().bindings[id]
}
