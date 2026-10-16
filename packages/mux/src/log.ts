import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { muxDirectory } from './paths'

/**
 * Bounded diagnostics shared by the mux daemon and its clients (desktop main, CLI).
 *
 * One JSON object per line is appended to `mux/server.log`. Records carry IDs, codes and
 * durations only: never terminal output, tokens, prompts, or file contents. When the file passes
 * `MAX_BYTES` it is rotated to `server.log.1`, so at most two generations are kept.
 */
export type LogLevel = 'info' | 'warn' | 'error'
export type LogContext = Record<string, unknown>

const MAX_BYTES = 1024 * 1024
const MAX_FIELD = 500
let proc: 'client' | 'daemon' = 'client'
let written = -1

export function setLogProcess(value: 'client' | 'daemon'): void {
  proc = value
}
export function logPath(): string {
  return join(muxDirectory(), 'server.log')
}
/** Moves an oversized log aside instead of deleting the evidence. */
export function rotateLog(): void {
  try {
    if (statSync(logPath()).size > MAX_BYTES) renameSync(logPath(), `${logPath()}.1`)
  } catch {
    /* No log yet. */
  }
  written = -1
}
/** Flattens errors and bounds every string so one bad value cannot flood the log. */
function plain(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const code = (value as Error & { code?: unknown }).code
    return {
      name: value.name,
      message: value.message.slice(0, MAX_FIELD),
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      stack: value.stack?.split('\n').slice(0, 8).join('\n').slice(0, 2000)
    }
  }
  if (typeof value === 'string') return value.length > MAX_FIELD ? value.slice(0, MAX_FIELD) : value
  if (value && typeof value === 'object' && depth < 2)
    return Array.isArray(value)
      ? value.slice(0, 20).map((item) => plain(item, depth + 1))
      : Object.fromEntries(
          Object.entries(value as object).map(([key, item]) => [key, plain(item, depth + 1)])
        )
  return value
}
export function log(level: LogLevel, event: string, context: LogContext = {}): void {
  try {
    if (written < 0) {
      rotateLog()
      written = 0
    }
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        proc,
        pid: process.pid,
        event,
        ...(plain(context) as LogContext)
      }) + '\n'
    try {
      appendFileSync(logPath(), line, { mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      mkdirSync(muxDirectory(), { recursive: true, mode: 0o700 })
      appendFileSync(logPath(), line, { mode: 0o600 })
    }
    written += line.length
    if (written > MAX_BYTES) rotateLog()
  } catch {
    /* Logging is best-effort and must never break the mux. */
  }
}
