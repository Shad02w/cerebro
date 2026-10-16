/** Reads whose result can be fetched again after the socket drops. */
const READS = new Set([
  'chat.overview',
  'chat.search',
  'chat.catalog',
  'chat.skills',
  'chat.attachment',
  'layout.get'
])

/**
 * The desktop keeps one mux socket. When it closes, in-flight calls reject even if the
 * server already accepted them — a sent prompt is the usual case. Reads can be issued
 * again. A send dedupes on commandId and returns the live view. Fork, rewind, and the
 * other mutations can apply twice, so a dropped socket stays an error for those.
 */
export function retriesAfterMuxDisconnect(method: string, params?: unknown): boolean {
  if (READS.has(method)) return true
  if (method !== 'chat.command') return false
  const action =
    params && typeof params === 'object' && 'action' in params
      ? (params as { action?: unknown }).action
      : undefined
  return action === 'get' || action === 'send'
}

/** True for the client error raised when the socket closes with a call still pending. */
export function isRecoverableMuxDisconnect(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : ''
  return /Mux disconnected|Mux is disconnected/i.test(message)
}
