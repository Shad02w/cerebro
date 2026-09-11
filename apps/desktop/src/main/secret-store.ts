import { safeStorage } from 'electron'
import { getDb } from './db'

const GITHUB_TOKEN_KEY = 'github_token'
const PLAINTEXT_PREFIX = 'plaintext:'

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test'
}

function writeValue(key: string, value: string): void {
  getDb()
    .prepare(
      `
        INSERT INTO app_state (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
    )
    .run(key, value)
}

function readValue(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

function deleteValue(key: string): void {
  getDb().prepare('DELETE FROM app_state WHERE key = ?').run(key)
}

export function storeSecret(key: string, plaintext: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(plaintext)
    writeValue(key, encrypted.toString('base64'))
    return
  }

  if (isTestEnv()) {
    writeValue(key, `${PLAINTEXT_PREFIX}${plaintext}`)
    return
  }

  throw new Error('Secure storage is unavailable on this system.')
}

export function readSecret(key: string): string | null {
  const stored = readValue(key)
  if (!stored) return null

  if (stored.startsWith(PLAINTEXT_PREFIX)) {
    if (!isTestEnv()) {
      throw new Error('Plaintext secrets are only allowed in tests.')
    }
    return stored.slice(PLAINTEXT_PREFIX.length)
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable on this system.')
  }

  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

export function deleteSecret(key: string): void {
  deleteValue(key)
}

export function storeGitHubToken(token: string): void {
  storeSecret(GITHUB_TOKEN_KEY, token)
}

export function readGitHubToken(): string | null {
  return readSecret(GITHUB_TOKEN_KEY)
}

export function deleteGitHubToken(): void {
  deleteSecret(GITHUB_TOKEN_KEY)
}
