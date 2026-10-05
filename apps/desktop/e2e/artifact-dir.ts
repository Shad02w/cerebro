import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Prefer a local evidence directory, then fall back when CI cannot create it. */
export async function ensureArtifactDir(preferred?: string): Promise<string> {
  const fallback = path.join(tmpdir(), 'cerebro-e2e-artifacts')
  const candidates = [process.env.CEREBRO_E2E_ARTIFACTS, preferred, fallback].filter(
    (value): value is string => Boolean(value)
  )
  let lastError: unknown
  for (const dir of [...new Set(candidates)]) {
    try {
      await mkdir(dir, { recursive: true })
      return dir
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Could not create an artifact directory.')
}
