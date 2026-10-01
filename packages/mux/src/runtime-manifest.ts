import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Written by the desktop CLI build next to `mux.cjs`; staged with the runtime. */
export type RuntimeManifest = {
  muxHash?: string
  builtAt?: number
  version?: string
  nodeVersion?: string
}
export async function readRuntimeManifest(directory: string): Promise<RuntimeManifest | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as RuntimeManifest) : undefined
  } catch {
    return undefined
  }
}
/**
 * A staged build replaces a running host only when it is a different and newer build. Clients
 * without build metadata, or older than the host, never restart it.
 */
export function runtimeOutdated(
  local: RuntimeManifest | undefined,
  running: RuntimeManifest | undefined
): boolean {
  if (!local?.muxHash || typeof local.builtAt !== 'number') return false
  if (running?.muxHash === local.muxHash) return false
  return typeof running?.builtAt !== 'number' || local.builtAt > running.builtAt
}
