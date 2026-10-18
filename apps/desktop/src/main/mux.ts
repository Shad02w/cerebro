import { app, BrowserWindow } from 'electron'
import { join, resolve } from 'node:path'
import {
  connectMux,
  log,
  MuxError,
  replaceUnauthorizedDaemon,
  type MuxClient,
  type TerminalEvent
} from '@cerebro/mux'
import type { AgentStatusEvent, LayoutState, WorkspaceTabs } from '@cerebro/core'
import { IPC } from '../shared/ipc'

let connection: Promise<MuxClient> | undefined
let quitting = false
let intentionallyStopped = false
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
// Reconnect retries every second; only the first failure of a streak is recorded.
let reconnectAttempts = 0
let lostAt: number | undefined
let cached: LayoutState = { revision: -1, workspaces: {} }
const terminalListeners = new Set<(event: TerminalEvent & { attachmentId: string }) => void>()
const statusListeners = new Set<(event: AgentStatusEvent) => void>()
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
export function onAgentStatus(listener: (event: AgentStatusEvent) => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}
export function getCachedLayout(): LayoutState {
  return cached
}
export function focusWorkspaceInUi(workspaceId: number): void {
  broadcast(IPC.layout.focusWorkspace, workspaceId)
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
      client.on('chat', (event) => broadcast(IPC.chat.changed, event))
      client.on('agent.status', (event: AgentStatusEvent) => {
        for (const listener of statusListeners) listener(event)
      })
      client.on('projects', () => broadcast(IPC.projects.invalidate))
      client.on('focus', (workspaceId) => broadcast(IPC.layout.focusWorkspace, workspaceId))
      client.on('git', async ({ id, args, cwd }) => {
        try {
          const { repositoryService } = await import('./projects')
          const result = await repositoryService.git(args, cwd)
          await client.request('git.reply', { id, result })
        } catch (error) {
          log('warn', 'desktop.git_provider_failed', { command: String(args?.[0]), error })
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
        if (!quitting) lostAt ??= Date.now()
        log(intentionallyStopped || quitting ? 'info' : 'warn', 'desktop.mux_disconnected', {
          intentionallyStopped,
          quitting
        })
        for (const listener of disconnectListeners) listener(intentionallyStopped)
        reconnectLater()
      })
      cached = await client.request<LayoutState>('subscribe')
      if (lostAt !== undefined)
        log('info', 'desktop.mux_reconnected', {
          downMs: Date.now() - lostAt,
          failedAttempts: reconnectAttempts
        })
      lostAt = undefined
      reconnectAttempts = 0
      broadcast(IPC.layout.changed, cached)
      broadcast(IPC.chat.changed, {})
      return client
    })().catch((error) => {
      connection = undefined
      if (++reconnectAttempts === 1) log('error', 'desktop.mux_connect_failed', { error })
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
      // A daemon from before the handshake token was removed cannot be asked to stop. Quitting
      // completely means it should be gone, so stop that process instead of failing the quit.
      if (error instanceof MuxError && error.code === 'unauthorized')
        if (await replaceUnauthorizedDaemon()) return
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
