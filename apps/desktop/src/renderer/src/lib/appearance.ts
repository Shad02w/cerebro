import { useSyncExternalStore } from 'react'

/** UI style variants. Each maps to a `[data-ui-style]` token block in `assets/themes.css`. */
export const UI_STYLES = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'The original Cerebro look with a teal selection glow.'
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Flat monochrome on floating panels. Hairline borders, ink buttons, green focus.'
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'Code-editor layout: activity bar, editor tabs and a status bar.'
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Soft and warm. Floating sidebar, projects grouped on cards.'
  },
  {
    id: 'swiss',
    label: 'Swiss',
    description: 'Sharp index layout. Square corners, heavy rules, numbered rows.'
  },
  {
    id: 'slate',
    label: 'Slate',
    description: 'Command bar across the top with a breadcrumb and global search.'
  }
] as const

export type UiStyleId = (typeof UI_STYLES)[number]['id']
export type ColorModePreference = 'light' | 'dark' | 'system'
export type ColorMode = 'light' | 'dark'
export type Appearance = { style: UiStyleId; mode: ColorModePreference }

export const DEFAULT_APPEARANCE: Appearance = { style: 'classic', mode: 'dark' }
const STORAGE_KEY = 'cerebro.appearance.v1'
const CHANGE_EVENT = 'cerebro-appearance'

export function isUiStyleId(value: unknown): value is UiStyleId {
  return UI_STYLES.some((style) => style.id === value)
}

function isModePreference(value: unknown): value is ColorModePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function parseAppearance(raw: string | null): Appearance {
  if (!raw) return DEFAULT_APPEARANCE
  try {
    const value = JSON.parse(raw) as Partial<Appearance>
    return {
      style: isUiStyleId(value.style) ? value.style : DEFAULT_APPEARANCE.style,
      mode: isModePreference(value.mode) ? value.mode : DEFAULT_APPEARANCE.mode
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

export function resolveColorMode(mode: ColorModePreference, prefersDark: boolean): ColorMode {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

type Snapshot = Appearance & { resolved: ColorMode }

let snapshot: Snapshot | null = null

function computeSnapshot(): Snapshot {
  const appearance = parseAppearance(readStored())
  const resolved = resolveColorMode(appearance.mode, systemPrefersDark())
  if (
    snapshot &&
    snapshot.style === appearance.style &&
    snapshot.mode === appearance.mode &&
    snapshot.resolved === resolved
  ) {
    return snapshot
  }
  snapshot = { ...appearance, resolved }
  return snapshot
}

/** Writes the style and mode onto `<html>` so every token block can resolve. */
export function applyAppearance(): Snapshot {
  const next = computeSnapshot()
  const root = document.documentElement
  root.dataset.uiStyle = next.style
  root.classList.toggle('dark', next.resolved === 'dark')
  root.style.colorScheme = next.resolved
  return next
}

export function setAppearance(patch: Partial<Appearance>): void {
  const next = { ...parseAppearance(readStored()), ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage can be unavailable; the attribute still applies for this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

const listeners = new Set<() => void>()
let installed = false

function notify(): void {
  applyAppearance()
  for (const listener of listeners) listener()
}

function install(): void {
  if (installed) return
  installed = true
  window.addEventListener(CHANGE_EVENT, notify)
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) notify()
  })
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', notify)
}

function subscribe(listener: () => void): () => void {
  install()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function initAppearance(): void {
  install()
  applyAppearance()
}

export function useAppearance(): Snapshot {
  return useSyncExternalStore(subscribe, computeSnapshot, computeSnapshot)
}
