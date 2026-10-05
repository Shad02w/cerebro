import { isAgentHarness } from './chat'
import { DEFAULT_TERMINAL_THEME, isTerminalThemeId } from './terminal-themes'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type {
  AgentModelDefaults,
  AppSettings,
  AppSettingsPatch,
  LastAgent,
  SidebarGroupBy
} from './types'
import {
  DEFAULT_AGENT_BACKGROUND,
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_FAMILY_AUTO,
  isAgentBackground
} from './types'
import { getDb } from './db'
import { getCerebroHome } from './paths'

const SETTINGS_KEY = 'settings'
const LEGACY_CLONE_LOCATION_KEY = 'clone_location'

type StoredSettings = {
  defaultCloneDir?: string
  terminalTheme?: string
  terminalFontSize?: number
  terminalFontFamily?: string
  agentBackground?: string
  keybinds?: Record<string, string>
  sidebarGroupBy?: string
  agentModelDefaults?: AgentModelDefaults
  lastAgent?: LastAgent | null
}

function defaultSettings(): AppSettings {
  return {
    defaultCloneDir: getCerebroHome(),
    terminalTheme: DEFAULT_TERMINAL_THEME,
    terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
    terminalFontFamily: TERMINAL_FONT_FAMILY_AUTO,
    agentBackground: DEFAULT_AGENT_BACKGROUND,
    keybinds: {},
    sidebarGroupBy: 'project',
    agentModelDefaults: {},
    lastAgent: null
  }
}

function normalizeProvider(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Unknown agent provider.')
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 200) throw new Error('Unknown agent provider.')
  return trimmed
}

function normalizeModelKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Agent model default must be a model key.')
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 1000) throw new Error('Agent model default must be a model key.')
  return trimmed
}

function readAgentModelDefaults(value: unknown): AgentModelDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: AgentModelDefaults = {}
  for (const [harness, raw] of Object.entries(value)) {
    if (!isAgentHarness(harness) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const providers: Record<string, string> = {}
    for (const [provider, key] of Object.entries(raw)) {
      if (typeof provider !== 'string' || typeof key !== 'string') continue
      try {
        providers[normalizeProvider(provider)] = normalizeModelKey(key)
      } catch {
        // Drop invalid stored entries.
      }
    }
    if (Object.keys(providers).length) next[harness] = providers
  }
  return next
}

function normalizeAgentModelDefaults(value: unknown): AgentModelDefaults {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent model defaults must be an object.')
  }
  const next: AgentModelDefaults = {}
  for (const [harness, raw] of Object.entries(value)) {
    if (!isAgentHarness(harness)) throw new Error('Unknown agent harness.')
    if (raw == null) continue
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Agent model defaults must be an object.')
    }
    const providers: Record<string, string> = {}
    for (const [provider, key] of Object.entries(raw)) {
      providers[normalizeProvider(provider)] = normalizeModelKey(key)
    }
    if (Object.keys(providers).length) next[harness] = providers
  }
  return next
}

function readLastAgent(value: unknown): LastAgent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const harness = (value as { harness?: unknown }).harness
  const provider = (value as { provider?: unknown }).provider
  if (!isAgentHarness(harness)) return null
  try {
    return { harness, provider: normalizeProvider(provider) }
  } catch {
    return null
  }
}

function normalizeLastAgent(value: unknown): LastAgent | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Last agent must be an object.')
  const harness = (value as { harness?: unknown }).harness
  if (!isAgentHarness(harness)) throw new Error('Unknown agent harness.')
  return { harness, provider: normalizeProvider((value as { provider?: unknown }).provider) }
}

function readLegacyCloneLocation(): string | undefined {
  const row = getDb()
    .prepare('SELECT value FROM app_state WHERE key = ?')
    .get(LEGACY_CLONE_LOCATION_KEY) as { value: string } | undefined
  const value = row?.value.trim()
  if (value && isAbsolute(value)) return value
  return undefined
}

function readStored(): StoredSettings {
  const row = getDb().prepare('SELECT value FROM app_state WHERE key = ?').get(SETTINGS_KEY) as
    { value: string } | undefined

  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value) as unknown
      if (parsed && typeof parsed === 'object') return parsed as StoredSettings
    } catch {
      // Fall through to legacy / defaults.
    }
  }

  const legacyClone = readLegacyCloneLocation()
  if (legacyClone) return { defaultCloneDir: legacyClone }
  return {}
}

function writeStored(stored: StoredSettings): void {
  getDb()
    .prepare(
      `
INSERT INTO app_state (key, value)
VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
    )
    .run(SETTINGS_KEY, JSON.stringify(stored))
}

function normalizeCloneDir(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Clone location is required.')
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(trimmed)
  if (existsSync(absolute) && !statSync(absolute).isDirectory()) {
    throw new Error('Clone location must be a directory.')
  }
  return absolute
}

function normalizeFontSize(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Font size must be a number.')
  const rounded = Math.round(value)
  if (rounded < MIN_TERMINAL_FONT_SIZE || rounded > MAX_TERMINAL_FONT_SIZE) {
    throw new Error(
      `Font size must be between ${MIN_TERMINAL_FONT_SIZE} and ${MAX_TERMINAL_FONT_SIZE}.`
    )
  }
  return rounded
}

function normalizeFontFamily(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Font family is required.')
  return trimmed
}

function normalizeSidebarGroupBy(value: unknown): SidebarGroupBy {
  return value === 'status' ? 'status' : 'project'
}

function normalizeKeybinds(value: unknown): Record<string, string> {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Keybinds must be an object.')
  }
  const next: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key.trim()) continue
    if (raw === null || raw === undefined) continue
    if (typeof raw !== 'string') throw new Error(`Keybind for ${key} must be a string.`)
    const trimmed = raw.trim()
    if (!trimmed) continue
    next[key.trim()] = trimmed
  }
  return next
}

function mergeSettings(stored: StoredSettings): AppSettings {
  const defaults = defaultSettings()
  let defaultCloneDir = defaults.defaultCloneDir
  let terminalFontSize = defaults.terminalFontSize
  let terminalFontFamily = defaults.terminalFontFamily
  let keybinds = defaults.keybinds
  const sidebarGroupBy = normalizeSidebarGroupBy(stored.sidebarGroupBy)

  if (typeof stored.defaultCloneDir === 'string' && stored.defaultCloneDir.trim()) {
    try {
      defaultCloneDir = normalizeCloneDir(stored.defaultCloneDir)
    } catch {
      // Keep default when stored value is invalid.
    }
  }

  if (typeof stored.terminalFontSize === 'number') {
    try {
      terminalFontSize = normalizeFontSize(stored.terminalFontSize)
    } catch {
      // Keep default when stored value is invalid.
    }
  }

  if (typeof stored.terminalFontFamily === 'string' && stored.terminalFontFamily.trim()) {
    try {
      terminalFontFamily = normalizeFontFamily(stored.terminalFontFamily)
    } catch {
      // Keep default when stored value is invalid.
    }
  }

  if (stored.keybinds !== undefined) {
    try {
      keybinds = normalizeKeybinds(stored.keybinds)
    } catch {
      // Keep default when stored value is invalid.
    }
  }

  const terminalTheme = isTerminalThemeId(stored.terminalTheme)
    ? stored.terminalTheme
    : DEFAULT_TERMINAL_THEME
  const agentBackground = isAgentBackground(stored.agentBackground)
    ? stored.agentBackground
    : DEFAULT_AGENT_BACKGROUND
  return {
    defaultCloneDir,
    terminalFontSize,
    terminalFontFamily,
    terminalTheme,
    agentBackground,
    keybinds,
    sidebarGroupBy,
    agentModelDefaults: readAgentModelDefaults(stored.agentModelDefaults),
    lastAgent: readLastAgent(stored.lastAgent)
  }
}

export function getSettings(): AppSettings {
  return mergeSettings(readStored())
}

export function setSettings(patch: AppSettingsPatch): AppSettings {
  const stored = readStored()
  const next: StoredSettings = { ...stored }

  if (patch.defaultCloneDir !== undefined) {
    if (typeof patch.defaultCloneDir !== 'string')
      throw new Error('Clone location must be a string.')
    const normalized = normalizeCloneDir(patch.defaultCloneDir)
    mkdirSync(normalized, { recursive: true })
    next.defaultCloneDir = normalized
  }

  if (patch.terminalFontSize !== undefined) {
    if (typeof patch.terminalFontSize !== 'number') throw new Error('Font size must be a number.')
    next.terminalFontSize = normalizeFontSize(patch.terminalFontSize)
  }

  if (patch.terminalFontFamily !== undefined) {
    if (typeof patch.terminalFontFamily !== 'string')
      throw new Error('Font family must be a string.')
    next.terminalFontFamily = normalizeFontFamily(patch.terminalFontFamily)
  }

  if (patch.keybinds !== undefined) {
    next.keybinds = normalizeKeybinds(patch.keybinds)
  }

  if (patch.terminalTheme !== undefined) {
    if (!isTerminalThemeId(patch.terminalTheme)) throw new Error('Unknown terminal theme.')
    next.terminalTheme = patch.terminalTheme
  }

  if (patch.sidebarGroupBy !== undefined) {
    if (patch.sidebarGroupBy !== 'project' && patch.sidebarGroupBy !== 'status') {
      throw new Error('Sidebar grouping must be project or status.')
    }
    next.sidebarGroupBy = patch.sidebarGroupBy
  }

  if (patch.agentBackground !== undefined) {
    if (!isAgentBackground(patch.agentBackground)) throw new Error('Unknown agent background.')
    next.agentBackground = patch.agentBackground
  }

  if (patch.agentModelDefaults !== undefined) {
    next.agentModelDefaults = normalizeAgentModelDefaults(patch.agentModelDefaults)
  }

  if (patch.lastAgent !== undefined) {
    next.lastAgent = normalizeLastAgent(patch.lastAgent)
  }

  writeStored(next)
  return mergeSettings(next)
}

/** Parent directory for new clones; creates the directory if needed. */
export function ensureCloneRoot(): string {
  const root = getSettings().defaultCloneDir
  mkdirSync(root, { recursive: true })
  return root
}
