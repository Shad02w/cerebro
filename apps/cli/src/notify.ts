import * as net from 'node:net'
import { getSocketPath } from '@cerebro/core'

/**
 * Best-effort notify: if the desktop app is running it will receive the
 * message and refresh its sidebar. If the socket is missing or the app is
 * closed the error is swallowed silently — the DB write already succeeded.
 */
export function notifyInvalidate(): void {
  const socketPath = getSocketPath()
  const msg = JSON.stringify({ type: 'invalidate' }) + '\n'

  const conn = net.createConnection(socketPath)
  conn.setTimeout(200)

  conn.on('connect', () => {
    conn.write(msg)
    conn.end()
  })

  // Swallow all errors — the app may not be running, which is fine.
  conn.on('error', () => conn.destroy())
  conn.on('timeout', () => conn.destroy())
}
