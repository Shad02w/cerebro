import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const APP_DIR_NAME = 'cerebro'
export const DB_FILE_NAME = 'cerebro.sqlite'

export function getCerebroHome(): string {
  return process.env.CEREBRO_HOME?.trim() || join(homedir(), APP_DIR_NAME)
}

export function getDatabasePath(): string {
  return process.env.CEREBRO_DB_PATH?.trim() || join(getCerebroHome(), DB_FILE_NAME)
}

export function ensureCerebroHome(): string {
  const home = getCerebroHome()
  mkdirSync(home, { recursive: true })
  return home
}

export function isReservedName(name: string): boolean {
  return (
    name === DB_FILE_NAME ||
    name.startsWith(`${DB_FILE_NAME}-`) ||
    name === 'cerebro.sqlite-wal' ||
    name === 'cerebro.sqlite-shm'
  )
}
