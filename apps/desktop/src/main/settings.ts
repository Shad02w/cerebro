import { existsSync, mkdirSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { AppSettings, AppSettingsPatch } from '../shared/types'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_FAMILY_AUTO
} from '../shared/types'
import { getDb } from './db'
import { getCerebroHome } from './paths'

const SETTINGS_KEY = 'settings'
const LEGACY_CLONE_LOCATION_KEY = 'clone_location'

type StoredSettings = {
  defaultCloneDir?: string
  terminalFontSize?: number
  terminalFontFamily?: string
}

function defaultSettings(): AppSettings {
  return {
    defaultCloneDir: getCerebroHome(),
    terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
    terminalFontFamily: TERMINAL_FONT_FAMILY_AUTO
  }
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
    | { value: string }
    | undefined
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value) as unknown
      if (parsed && typeof parsed === 'object') {
        return parsed as StoredSettings
      }
    } catch {
      // Fall through to legacy / defaults.
    }
  }

  const legacyClone = readLegacyCloneLocation()
  if (legacyClone) {
    return { defaultCloneDir: legacyClone }
  }
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
  if (!trimmed) {
    throw new Error('Clone location is required.')
  }
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(trimmed)
  if (existsSync(absolute) && !statSync(absolute).isDirectory()) {
    throw new Error('Clone location must be a directory.')
  }
  return absolute
}

function normalizeFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Font size must be a number.')
  }
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
  if (!trimmed) {
    throw new Error('Font family is required.')
  }
  return trimmed
}

function mergeSettings(stored: StoredSettings): AppSettings {
  const defaults = defaultSettings()
  let defaultCloneDir = defaults.defaultCloneDir
  let terminalFontSize = defaults.terminalFontSize
  let terminalFontFamily = defaults.terminalFontFamily

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

  return { defaultCloneDir, terminalFontSize, terminalFontFamily }
}

export function getSettings(): AppSettings {
  return mergeSettings(readStored())
}

export function setSettings(patch: AppSettingsPatch): AppSettings {
  const stored = readStored()
  const next: StoredSettings = { ...stored }

  if (patch.defaultCloneDir !== undefined) {
    if (typeof patch.defaultCloneDir !== 'string') {
      throw new Error('Clone location must be a string.')
    }
    const normalized = normalizeCloneDir(patch.defaultCloneDir)
    mkdirSync(normalized, { recursive: true })
    next.defaultCloneDir = normalized
  }

  if (patch.terminalFontSize !== undefined) {
    if (typeof patch.terminalFontSize !== 'number') {
      throw new Error('Font size must be a number.')
    }
    next.terminalFontSize = normalizeFontSize(patch.terminalFontSize)
  }

  if (patch.terminalFontFamily !== undefined) {
    if (typeof patch.terminalFontFamily !== 'string') {
      throw new Error('Font family must be a string.')
    }
    next.terminalFontFamily = normalizeFontFamily(patch.terminalFontFamily)
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

export async function pickDirectory(sender: Electron.WebContents): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender)
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose default clone location',
    defaultPath: getSettings().defaultCloneDir
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0] ?? null
}
