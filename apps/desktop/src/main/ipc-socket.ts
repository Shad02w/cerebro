import { layoutCommand, LayoutError, removeWorkspaceLayout, knownWorkspaceIds } from './panes'
import { listProjects, type LayoutCommand } from '@cerebro/core'
/**
 * Unix domain socket server that lets the CLI (or any other local process)
 * refresh the sidebar and manage live tabs and BSP panes.
 *
 * Protocol: newline-delimited JSON.
 *   { "type": "invalidate" } — refreshes the project list (no reply).
 *   { "type": "layout", "command": LayoutCommand } — returns { result } or a structured error.
 *
 * The socket lives at $CEREBRO_HOME/cerebro.sock (mode 0600).
 * It is created on app ready and removed on quit.
 * If a stale socket file exists from a previous crash it is unlinked first.
 */
import { createServer, type Server } from 'node:net'
import { unlinkSync, chmodSync, existsSync } from 'node:fs'
import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { getSocketPath } from './paths'

let socketServer: Server | null = null

export function startSocketServer(): void {
  const socketPath = getSocketPath()

  // Remove stale socket from a previous crash so listen() does not fail.
  try {
    if (existsSync(socketPath)) unlinkSync(socketPath)
  } catch {
    // Best-effort; if we can't remove it, listen() will fail and we log.
  }

  const server = createServer((conn) => {
    let buf = ''

    conn.setEncoding('utf8')

    conn.on('data', (chunk: string) => {
      buf += chunk
      if (buf.length > 65536) {
        conn.destroy()
        return
      }
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let message: unknown
        try {
          message = JSON.parse(trimmed)
        } catch {
          conn.end(JSON.stringify({ error: true, code: 'usage', message: 'Invalid JSON.' }) + '\n')
          continue
        }
        if (
          message &&
          typeof message === 'object' &&
          (message as { type?: unknown }).type === 'layout'
        ) {
          try {
            const reply = layoutCommand((message as { command?: unknown }).command)
            const command = (message as { command: LayoutCommand }).command
            if (command.action === 'focus') {
              for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed())
                  win.webContents.send(IPC.layout.focusWorkspace, command.workspaceId)
              }
            }
            conn.end(JSON.stringify({ result: reply.result }) + '\n')
          } catch (error) {
            conn.end(
              JSON.stringify({
                error: true,
                code: error instanceof LayoutError ? error.code : 'internal',
                message: error instanceof Error ? error.message : String(error)
              }) + '\n'
            )
          }
        } else handleMessage(trimmed)
      }
    })

    conn.on('error', () => {
      // Connection-level errors (e.g. client disconnected mid-write) are ignored.
    })
  })

  server.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o600)
    } catch {
      // Non-fatal — better to run without strict perms than not at all.
    }
  })

  server.on('error', (err) => {
    console.error('[ipc-socket] Failed to start socket server:', err.message)
  })

  socketServer = server
}

export function stopSocketServer(): void {
  if (!socketServer) return
  socketServer.close()
  socketServer = null

  const socketPath = getSocketPath()
  try {
    if (existsSync(socketPath)) unlinkSync(socketPath)
  } catch {
    // Best-effort cleanup.
  }
}

function handleMessage(raw: string): void {
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }

  if (!msg || typeof msg !== 'object') return

  const type = (msg as Record<string, unknown>).type

  if (type === 'invalidate') {
    void listProjects()
      .then((listed) => {
        const ids = new Set(
          listed.projects.flatMap((project) => project.workspaces.map((workspace) => workspace.id))
        )
        // Layout cleanup for workspaces unregistered through the CLI.
        for (const workspaceId of knownWorkspaceIds())
          if (!ids.has(workspaceId)) removeWorkspaceLayout(workspaceId)
      })
      .catch((error) => console.error('[ipc-socket] Layout cleanup failed:', error))
    // Tell every renderer to re-fetch project list.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.projects.invalidate)
      }
    }
  }
}
