import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react'
import type { KeybindActionId } from '@shared/keybinds'

export type KeybindHandler = () => boolean | void

export type KeybindContextValue = {
  bindings: Record<KeybindActionId, string>
  recording: boolean
  setRecording: (recording: boolean) => void
  registerHandler: (id: KeybindActionId, handler: KeybindHandler) => () => void
  invokeAction: (id: KeybindActionId) => void
}

export const KeybindContext = createContext<KeybindContextValue | null>(null)

export function useKeybinds(): KeybindContextValue {
  const ctx = useContext(KeybindContext)
  if (!ctx) throw new Error('useKeybinds must be used within KeybindProvider.')
  return ctx
}

/** Register an app-level handler for a keybind action. Returns handled=true to skip native fallback. */
export function useKeybindHandler(id: KeybindActionId, handler: KeybindHandler): void {
  const { registerHandler } = useKeybinds()
  const handlerRef = useRef(handler)
  useLayoutEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    return registerHandler(id, () => handlerRef.current())
  }, [id, registerHandler])
}

export function useKeybindBinding(id: KeybindActionId): string {
  return useKeybinds().bindings[id]
}
