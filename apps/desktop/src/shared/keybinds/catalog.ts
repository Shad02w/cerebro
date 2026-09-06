export const KEYBIND_ACTION_IDS = ['closeTab', 'newTerminal', 'toggleSidebar', 'toggleDevTools'] as const

export type KeybindActionId = (typeof KEYBIND_ACTION_IDS)[number]

export type KeybindTarget = 'app' | 'native'

export type NativeCommandId = 'closeWindow' | 'toggleDevTools'

export type KeybindAction = {
  id: KeybindActionId
  label: string
  description: string
  /** TanStack hotkey string, e.g. `Mod+W`. */
  defaultHotkey: string
  target: KeybindTarget
  /** Native command invoked when `target` is `native`, or as a fallback for app actions. */
  nativeCommand?: NativeCommandId
}

export const KEYBIND_CATALOG: readonly KeybindAction[] = [
  {
    id: 'closeTab',
    label: 'Close tab',
    description: 'Close the active terminal tab. Closes the window when no tab is open.',
    defaultHotkey: 'Mod+W',
    target: 'app',
    nativeCommand: 'closeWindow'
  },
  {
    id: 'newTerminal',
    label: 'New terminal',
    description:
      'Open a terminal for the focused workspace row. Opens a new tab when a workspace is already selected.',
    defaultHotkey: 'Mod+T',
    target: 'app'
  },
  {
    id: 'toggleSidebar',
    label: 'Toggle sidebar',
    description: 'Expand or collapse the sidebar.',
    defaultHotkey: 'Mod+B',
    target: 'app'
  },
  {
    id: 'toggleDevTools',
    label: 'Toggle Developer Tools',
    description: 'Open or close Chromium DevTools for this window.',
    defaultHotkey: 'Mod+Alt+I',
    target: 'native',
    nativeCommand: 'toggleDevTools'
  }
] as const

export type KeybindOverrides = Partial<Record<KeybindActionId, string>>

export function isKeybindActionId(value: string): value is KeybindActionId {
  return (KEYBIND_ACTION_IDS as readonly string[]).includes(value)
}

export function getKeybindAction(id: KeybindActionId): KeybindAction {
  const action = KEYBIND_CATALOG.find((item) => item.id === id)
  if (!action) throw new Error(`Unknown keybind action: ${id}`)
  return action
}

/** Resolve stored overrides against catalog defaults. */
export function resolveKeybinds(overrides?: KeybindOverrides | null): Record<KeybindActionId, string> {
  const resolved = {} as Record<KeybindActionId, string>
  for (const action of KEYBIND_CATALOG) {
    const override = overrides?.[action.id]
    resolved[action.id] =
      typeof override === 'string' && override.trim() ? override.trim() : action.defaultHotkey
  }
  return resolved
}

/**
 * Returns the action id that already uses `hotkey`, or null if free.
 * `except` excludes the action being remapped.
 */
export function findKeybindConflict(
  hotkey: string,
  bindings: Record<KeybindActionId, string>,
  except?: KeybindActionId
): KeybindActionId | null {
  const normalized = hotkey.trim()
  for (const id of KEYBIND_ACTION_IDS) {
    if (except && id === except) continue
    if (bindings[id] === normalized) return id
  }
  return null
}

export function normalizeKeybindOverrides(value: unknown): KeybindOverrides | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Keybinds must be an object.')
  }
  const input = value as Record<string, unknown>
  const next: KeybindOverrides = {}
  for (const [key, raw] of Object.entries(input)) {
    if (!isKeybindActionId(key)) continue
    if (raw === null || raw === undefined) continue
    if (typeof raw !== 'string') throw new Error(`Keybind for ${key} must be a string.`)
    const trimmed = raw.trim()
    if (!trimmed) continue
    next[key] = trimmed
  }
  return Object.keys(next).length > 0 ? next : undefined
}
