import { app, BrowserWindow } from 'electron'
import { join, resolve } from 'node:path'
import { connectMux, MuxError, type MuxClient, type TerminalEvent } from '@cerebro/mux'
import type { LayoutState, WorkspaceTabs } from '@cerebro/core'
import { IPC } from '../shared/ipc'

let connection: Promise<MuxClient> | undefined
let quitting = false
let intentionallyStopped = false
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let cached: LayoutState = { revision: -1, workspaces: {} }
const terminalListeners = new Set<(event: TerminalEvent & { attachmentId: string }) => void>()
const disconnectListeners = new Set<(stopped: boolean) => void>()
const broadcast = (channel: string, data?: unknown): void => {
  for (const win of BrowserWindow.getAllWindows())
    if (!win.isDestroyed()) win.webContents.send(channel, data)
}
export function onTerminal(
  listener: (event: TerminalEvent & { attachmentId: string }) => void
): () => void {
  terminalListeners.add(listener)
  return () => {
    terminalListeners.delete(listener)
  }
}
export function onMuxDisconnect(listener: (stopped: boolean) => void): () => void {
  disconnectListeners.add(listener)
  return () => {
    disconnectListeners.delete(listener)
  }
}
function reconnectLater(): void {
  if (quitting || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    void getMux().catch(() => reconnectLater())
  }, 1000)
}
export function getMux(): Promise<MuxClient> {
  if (quitting) return Promise.reject(new Error('Cerebro is closing.'))
  if (!connection)
    connection = (async () => {
      const client = await connectMux({
        autoStart: !intentionallyStopped,
        runtimeDir: app.isPackaged
          ? join(process.resourcesPath, 'cli')
          : resolve(__dirname, '../cli')
      })
      intentionallyStopped = false
      client.on('shutdown', ({ requested }) => {
        intentionallyStopped = Boolean(requested)
      })
      client.on('terminal', (event) => {
        for (const listener of terminalListeners) listener(event)
      })
      client.on(
        'layout',
        (event: {
          state?: LayoutState
          epoch: string
          revision: number
          workspaceId: number
          workspace: WorkspaceTabs | null
        }) => {
          if (event.state) cached = event.state
          else if (event.epoch === cached.epoch && event.revision >= cached.revision) {
            const workspaces = { ...cached.workspaces }
            if (event.workspace) workspaces[event.workspaceId] = event.workspace
            else delete workspaces[event.workspaceId]
            cached = { ...cached, revision: event.revision, workspaces }
          }
          broadcast(IPC.layout.changed, cached)
        }
      )
      client.on('projects', () => broadcast(IPC.projects.invalidate))
      client.on('focus', (workspaceId) => broadcast(IPC.layout.focusWorkspace, workspaceId))
      client.on('git', async ({ id, args, cwd }) => {
        try {
          const { repositoryService } = await import('./projects')
          const result = await repositoryService.git(args, cwd)
          await client.request('git.reply', { id, result })
        } catch (error) {
          await client
            .request('git.reply', {
              id,
              error: error instanceof Error ? error.message : String(error)
            })
            .catch(() => {})
        }
      })
      client.on('disconnected', () => {
        connection = undefined
        for (const listener of disconnectListeners) listener(intentionallyStopped)
        reconnectLater()
      })
      cached = await client.request<LayoutState>('subscribe')
      broadcast(IPC.layout.changed, cached)
      return client
    })().catch((error) => {
      connection = undefined
      throw error
    })
  return connection
}
export async function muxCall<T>(method: string, params: unknown = {}): Promise<T> {
  const action = (params as { action?: string })?.action
  if (
    method === 'terminal.restart' ||
    ((method === 'registry' || method === 'layout.command') && action && action !== 'list')
  )
    intentionallyStopped = false
  return (await getMux()).request<T>(method, params)
}
export function disconnectMux(): void {
  quitting = true
  clearTimeout(reconnectTimer)
  void connection?.then((client) => client.close()).catch(() => {})
  connection = undefined
}

export async function stopMuxForQuit(): Promise<void> {
  quitting = true
  clearTimeout(reconnectTimer)
  reconnectTimer = undefined
  let client: MuxClient | undefined
  try {
    // Let any in-flight startup finish before connecting without auto-start.
    await connection?.catch(() => {})
    try {
      client = await connectMux({ autoStart: false })
    } catch (error) {
      if (error instanceof MuxError && error.code === 'unavailable') return
      throw error
    }
    const stoppingClient = client
    let timer: ReturnType<typeof setTimeout> | undefined
    let disconnected: () => void = () => {}
    const stopped = new Promise<void>((resolve, reject) => {
      disconnected = resolve
      stoppingClient.once('disconnected', disconnected)
      timer = setTimeout(() => reject(new Error('Terminal server shutdown timed out.')), 120_000)
    })
    try {
      // The reply acknowledges the request; disconnect follows shell shutdown and storage flush.
      await Promise.all([stoppingClient.request('server.stop'), stopped])
    } finally {
      clearTimeout(timer)
      stoppingClient.off('disconnected', disconnected)
    }
  } catch (error) {
    quitting = false
    reconnectLater()
    throw error
  } finally {
    client?.close()
  }
}
