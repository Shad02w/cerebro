import { existsSync, mkdirSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { getDb } from './db'
import { getCerebroHome } from './paths'

const CLONE_LOCATION_KEY = 'clone_location'

export function getCloneLocation(): string {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(CLONE_LOCATION_KEY) as
    { value: string } | undefined
  const value = row?.value.trim()
  if (value && isAbsolute(value)) return value
  return getCerebroHome()
}

export function setCloneLocation(location: string): string {
  const trimmed = location.trim()
  if (!trimmed) {
    throw new Error('Clone location is required.')
  }
  if (!isAbsolute(trimmed)) {
    throw new Error('Clone location must be an absolute path.')
  }
  if (existsSync(trimmed)) {
    if (!statSync(trimmed).isDirectory()) {
      throw new Error('Clone location must be a directory.')
    }
  } else {
    mkdirSync(trimmed, { recursive: true })
  }

  const db = getDb()
  db.prepare(
    `
      INSERT INTO app_state (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run(CLONE_LOCATION_KEY, trimmed)

  return trimmed
}

export async function chooseCloneLocation(event: IpcMainInvokeEvent): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose clone location',
    defaultPath: getCloneLocation(),
    properties: ['openDirectory', 'createDirectory']
  }
  const parent = BrowserWindow.fromWebContents(event.sender)
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  return setCloneLocation(result.filePaths[0])
}
