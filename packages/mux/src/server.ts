import { claimServer, releaseServer } from './ownership'
import { createServer } from 'node:net'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, unlink, chmod, stat, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LayoutState, Pane, PaneNode, ProjectListResult } from '@cerebro/core'
import {
  VERSION,
  Wire,
  MuxError,
  type Message,
  type RequestParams,
  type TerminalEvent
} from './protocol'
import { muxDirectory, socketPath, databasePath } from './paths'
import { StorageWorker } from './worker-client'
import { AgentSessions } from './agents/service'
import type { ChatCommand } from '@cerebro/core'
import { Terminals } from './terminals'

const leaves = (node: PaneNode): Pane[] =>
  node.type === 'pane' ? [node] : [...leaves(node.first), ...leaves(node.second)]
type Peer = {
  wire: Wire
  inFlight: number
  authorized: boolean
  subscribed: boolean
  attachments: Map<number, { id: string; ready: boolean; events: TerminalEvent[] }>
}
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new MuxError('usage', 'A positive ID is required.')
  return Number(value)
}
export async function startServer(): Promise<void> {
  await mkdir(muxDirectory(), { recursive: true, mode: 0o700 })
  if (!claimServer()) return
  const token = await readFile(join(muxDirectory(), 'token'), 'utf8')
  const peers = new Set<Peer>()
  const owners = new Map<number, Peer>()
  const epoch = randomUUID()
  const storage = new StorageWorker()
  let layout = await storage.call<LayoutState>('layout.get')
  layout.epoch = epoch
  let serial = Promise.resolve()
  let registrySerial = Promise.resolve()
  const mutation = async <T>(
    id: string,
    method: string,
    params: unknown,
    action: () => Promise<T>
  ): Promise<T> => {
    if (method === 'layout.command' && (params as { action?: string }).action === 'list')
      return action()
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ method, params }))
      .digest('hex')
    const previous = await storage.call<{
      cached: { result?: T; error?: { code: string; message: string } }
    } | null>('operation.begin', { id, fingerprint })
    if (previous) {
      if (previous.cached.error)
        throw new MuxError(previous.cached.error.code, previous.cached.error.message)
      return previous.cached.result as T
    }
    try {
      const result = await action()
      await storage.call('operation.finish', { id, reply: { result } })
      return result
    } catch (error) {
      const failure = error as Error & { code?: string }
      await storage
        .call('operation.finish', {
          id,
          reply: { error: { code: failure.code ?? 'internal', message: failure.message } }
        })
        .catch(() => {})
      throw error
    }
  }
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = serial.then(fn)
    serial = next.then(
      () => {},
      () => {}
    )
    return next
  }
  const registryExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = registrySerial.then(fn)
    registrySerial = next.then(
      () => {},
      () => {}
    )
    return next
  }
  const publish = (event: string, data: unknown): void => {
    for (const peer of peers)
      if (peer.authorized && peer.subscribed) peer.wire.send({ event, data })
  }
  const agents = new AgentSessions(join(muxDirectory(), 'agents'), (workspaceId) =>
    publish('chat', { workspaceId })
  )
  const terminals = new Terminals(storage, (event) => {
    for (const peer of peers) {
      const attachment = peer.attachments.get(event.paneId)
      if (!attachment) continue
      if (attachment.ready)
        peer.wire.send({ event: 'terminal', data: { ...event, attachmentId: attachment.id } })
      else if (attachment.events.length < 128) attachment.events.push(event)
      else peer.wire.socket.destroy()
    }
  })
  const findPane = (workspaceId: number, paneId: number): { pane: Pane; tabId: number } => {
    for (const tab of layout.workspaces[workspaceId]?.tabs ?? []) {
      const pane = leaves(tab.root).find((pane) => pane.id === paneId)
      if (pane) return { pane, tabId: tab.id }
    }
    throw new MuxError('not_found', 'Pane not found in this workspace.')
  }
  const ensureTerminal = async (p: RequestParams): Promise<number> => {
    const workspaceId = positive(p.workspaceId),
      paneId = positive(p.paneId)
    const { pane, tabId } = findPane(workspaceId, paneId)
    if (pane.kind !== 'terminal') throw new MuxError('conflict', 'Pane is not a terminal.')
    await terminals.ensure(workspaceId, tabId, pane)
    return paneId
  }
  const accessTerminal = (p: RequestParams): Promise<number> =>
    terminals.has(positive(p.paneId)) ? ensureTerminal(p) : exclusive(() => ensureTerminal(p))
  const updateLayout = (state: LayoutState, workspaceId?: number): void => {
    layout = { ...state, epoch }
    publish(
      'layout',
      workspaceId
        ? {
            epoch,
            revision: layout.revision,
            workspaceId,
            workspace: layout.workspaces[workspaceId] ?? null
          }
        : { state: layout }
    )
  }
  const providers = new Map<string, Peer>()
  const gitPending = new Map<
    string,
    {
      peer: Peer
      resolve: (data: string) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  storage.onGit = (operationId, args, cwd) =>
    new Promise((resolve, reject) => {
      if (stopping) {
        reject(new MuxError('unavailable', 'Mux is stopping.'))
        return
      }
      const peer = providers.get(operationId)
      if (!peer) {
        reject(new MuxError('unavailable', 'Desktop Git provider disconnected.'))
        return
      }
      const id = randomUUID()
      const timer = setTimeout(() => {
        gitPending.delete(id)
        reject(new Error('Git provider timed out.'))
      }, 120000)
      gitPending.set(id, { peer, resolve, reject, timer })
      peer.wire.send({ event: 'git', data: { id, args, cwd } })
    })
  async function registry(peer: Peer, p: RequestParams, operationId: string): Promise<unknown> {
    if (
      ![
        'list',
        'select',
        'project.createDirectory',
        'project.create',
        'workspace.create',
        'workspace.remove',
        'project.remove'
      ].includes(p.action)
    )
      throw new MuxError('usage', 'Unknown registry action.')
    if (p.action === 'list') return storage.call('registry', p)
    const listed = await storage.call<ProjectListResult>('registry', { action: 'list' })
    let removed: number[] = []
    if (p.action === 'workspace.remove') {
      const workspace = listed.projects
        .flatMap((project) => project.workspaces)
        .find((workspace) => workspace.id === positive(p.workspaceId))
      if (!workspace) throw new MuxError('not_found', 'Workspace not found.')
      if (workspace.kind !== 'worktree')
        throw new MuxError(
          'conflict',
          'Default/root workspace cannot be removed. Remove the project instead.'
        )
      removed = [workspace.id]
    } else if (p.action === 'project.remove') {
      const project = listed.projects.find((project) => project.id === positive(p.projectId))
      if (!project) throw new MuxError('not_found', 'Project not found.')
      removed = project.workspaces.map((workspace) => workspace.id)
    }
    for (const workspaceId of removed) await agents.stopWorkspace(workspaceId)
    for (const workspaceId of removed)
      for (const tab of layout.workspaces[workspaceId]?.tabs ?? [])
        for (const pane of leaves(tab.root))
          if (pane.kind === 'terminal') await terminals.stop(pane.id)
    if (p.provider) providers.set(operationId, peer)
    try {
      const result = await storage.call('registry', { ...p, operationId })
      for (const workspaceId of removed) {
        for (const tab of layout.workspaces[workspaceId]?.tabs ?? [])
          for (const pane of leaves(tab.root)) await terminals.stop(pane.id, true)
        updateLayout(await storage.call('layout.remove', { workspaceId }), workspaceId)
      }
      if (p.action !== 'list') publish('projects', {})
      return result
    } finally {
      providers.delete(operationId)
    }
  }
  let stopping = false
  const server = createServer((socket) => {
    const peer: Peer = {
      wire: new Wire(socket),
      inFlight: 0,
      authorized: false,
      subscribed: false,
      attachments: new Map()
    }
    peers.add(peer)
    const handshakeTimer = setTimeout(() => socket.destroy(), 5000)
    peer.wire.on('close', () => {
      clearTimeout(handshakeTimer)
      peers.delete(peer)
      for (const [paneId, owner] of owners) if (owner === peer) owners.delete(paneId)
      for (const [id, request] of gitPending)
        if (request.peer === peer) {
          clearTimeout(request.timer)
          request.reject(new Error('Git provider disconnected.'))
          gitPending.delete(id)
        }
    })
    peer.wire.on('message', (message: Message) => {
      if (++peer.inFlight > 256) {
        socket.destroy()
        return
      }
      void (async () => {
        const p = (message.params ?? {}) as RequestParams
        if (
          typeof message.id !== 'string' ||
          message.id.length < 1 ||
          message.id.length > 128 ||
          typeof message.method !== 'string' ||
          !p ||
          typeof p !== 'object' ||
          Array.isArray(p)
        )
          throw new MuxError('usage', 'Request ID and method required.')
        if (message.method === 'hello') {
          if (p.version !== VERSION)
            throw new MuxError(
              'conflict',
              'Mux protocol version differs; explicitly restart the server to upgrade.'
            )
          if (p.token !== token) throw new MuxError('unauthorized', 'Mux authentication failed.')
          if (p.database !== databasePath())
            throw new MuxError('conflict', 'This CEREBRO_HOME already owns a different database.')
          peer.authorized = true
          clearTimeout(handshakeTimer)
          return { epoch, version: VERSION, pid: process.pid }
        }
        if (stopping) throw new MuxError('unavailable', 'Mux is stopping.')
        if (!peer.authorized) throw new MuxError('unauthorized', 'Handshake required.')
        switch (message.method) {
          case 'server.status':
            return {
              running: true,
              pid: process.pid,
              epoch,
              version: VERSION,
              scrollback: terminals.scrollback,
              memory: process.memoryUsage(),
              cpu: process.cpuUsage()
            }
          case 'server.stop':
            setTimeout(() => void shutdown(true), 30)
            return { stopped: true }
          case 'subscribe':
            peer.subscribed = true
            return layout
          case 'chat.catalog':
            return agents.models(Boolean((p as unknown as { refresh?: boolean }).refresh))
          case 'chat.favorite': {
            const favorite = p as unknown as { key: string; favorite: boolean }
            if (typeof favorite.key !== 'string' || typeof favorite.favorite !== 'boolean')
              throw new MuxError('usage', 'Invalid favorite.')
            return agents.favorite(favorite.key, favorite.favorite)
          }
          case 'chat.command':
            return exclusive(async () => {
              const workspaceId = positive(p.workspaceId),
                paneId = positive(p.paneId)
              const { pane } = findPane(workspaceId, paneId)
              if (pane.kind !== 'chat') throw new MuxError('conflict', 'Pane is not a chat.')
              const context = await storage.call<{ cwd: string; repositoryId: number | null }>(
                'context',
                { workspaceId, repositoryId: pane.repositoryId ?? undefined }
              )
              return agents.command(
                { ...context, workspaceId, paneId },
                p as unknown as ChatCommand
              )
            })
          case 'layout.get':
            return layout
          case 'changes.list':
          case 'changes.file':
            return storage.call(message.method, p)
          case 'layout.measure':
            return storage.call('layout.measure', p)
          case 'pane.state':
            return exclusive(async () => {
              const state = await storage.call<LayoutState>('pane.state', p)
              updateLayout(state, p.workspaceId)
              return layout
            })
          case 'layout.command':
            return exclusive(() =>
              mutation(message.id!, message.method!, p, async () => {
                const context = await storage.call<{ repositoryId: number | null }>('context', {
                  workspaceId: positive(p.workspaceId),
                  repositoryId: p.repositoryId
                })
                if (p.repositoryId === undefined && context.repositoryId !== null)
                  p.repositoryId = context.repositoryId
                const before = new Set(
                  (layout.workspaces[p.workspaceId]?.tabs ?? [])
                    .flatMap((tab) => leaves(tab.root))
                    .map((pane) => pane.id)
                )
                const reply = await storage.call<{ state: LayoutState; result: unknown }>(
                  'layout.command',
                  p
                )
                updateLayout(reply.state, p.workspaceId)
                for (const tab of layout.workspaces[p.workspaceId]?.tabs ?? [])
                  for (const pane of leaves(tab.root)) {
                    if (!before.delete(pane.id) && pane.kind === 'terminal')
                      await terminals.ensure(p.workspaceId, tab.id, pane, true)
                  }
                for (const id of before) {
                  await terminals.stop(id, true)
                  owners.delete(id)
                  for (const peer of peers) peer.attachments.delete(id)
                }
                if (p.action === 'focus') {
                  await storage.call('registry', { action: 'select', workspaceId: p.workspaceId })
                  publish('focus', p.workspaceId)
                }
                return { ...reply, state: layout }
              })
            )
          case 'registry': {
            if (p.action === 'list') return registry(peer, p, message.id!)
            const apply = (): Promise<unknown> =>
              mutation(message.id!, message.method!, p, () => registry(peer, p, message.id!))
            if (p.action === 'select') return exclusive(apply)
            return registryExclusive(() =>
              p.action.endsWith('.remove') ? exclusive(apply) : apply()
            )
          }
          case 'git.reply': {
            const request = gitPending.get(p.id)
            if (!request || request.peer !== peer)
              throw new MuxError('not_found', 'Git callback not found.')
            clearTimeout(request.timer)
            gitPending.delete(p.id)
            if (p.error) request.reject(new Error(p.error))
            else request.resolve(p.result)
            return null
          }
          case 'terminal.attach':
            return exclusive(async () => {
              const paneId = await ensureTerminal(p)
              const attachment = { id: randomUUID(), ready: false, events: [] as TerminalEvent[] }
              peer.attachments.set(paneId, attachment)
              if (!owners.has(paneId) || p.takeOwnership === true) owners.set(paneId, peer)
              const snapshot = await terminals.snapshot(paneId, true)
              const result = {
                ...snapshot,
                attachmentId: attachment.id,
                readOnly: owners.get(paneId) !== peer
              }
              peer.wire.send({ id: message.id, result })
              attachment.ready = true
              for (const event of attachment.events)
                if (event.sequence > snapshot.sequence)
                  peer.wire.send({
                    event: 'terminal',
                    data: { ...event, attachmentId: attachment.id }
                  })
              attachment.events = []
              return SENT
            })
          case 'terminal.detach': {
            for (const [paneId, attachment] of peer.attachments)
              if (attachment.id === p.attachmentId) {
                peer.attachments.delete(paneId)
                if (owners.get(paneId) === peer) owners.delete(paneId)
              }
            return null
          }
          case 'terminal.capture':
            return terminals.capture(await accessTerminal(p), p.scrollback ?? 0, p.format ?? 'text')
          case 'terminal.restart':
            return exclusive(async () => terminals.restart(await ensureTerminal(p)))
          case 'terminal.write': {
            const paneId = await accessTerminal(p)
            if (
              p.attachmentId &&
              (owners.get(paneId) !== peer || peer.attachments.get(paneId)?.id !== p.attachmentId)
            )
              throw new MuxError('conflict', 'Terminal attachment is read-only or stale.')
            const snapshot = p.sessionId ? null : await terminals.capture(paneId)
            terminals.input(paneId, p.sessionId ?? snapshot!.sessionId, p.data)
            return null
          }
          case 'terminal.resize': {
            const paneId = await accessTerminal(p)
            if (owners.get(paneId) !== peer || peer.attachments.get(paneId)?.id !== p.attachmentId)
              throw new MuxError('conflict', 'Only the active attachment may resize.')
            if (typeof p.sessionId !== 'string')
              throw new MuxError('usage', 'Session generation required.')
            return terminals.resize(paneId, p.sessionId, p.cols, p.rows)
          }
          default:
            throw new MuxError('usage', 'Unknown mux command.')
        }
      })().then(
        (result) => {
          peer.inFlight--
          if (result !== SENT) peer.wire.send({ id: message.id, result })
        },
        (error) => {
          peer.inFlight--
          peer.wire.send({
            id: message.id,
            error: { code: error.code ?? 'internal', message: error.message }
          })
        }
      )
    })
  })
  server.maxConnections = 64
  const SENT = Symbol('sent')
  if (process.platform !== 'win32') await unlink(socketPath()).catch(() => {})
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath(), resolve)
  })
  if (process.platform !== 'win32') await chmod(socketPath(), 0o600)
  const timer = setInterval(() => void terminals.flush(), 1000)
  async function shutdown(requested = false): Promise<void> {
    if (stopping) return
    stopping = true
    for (const peer of peers)
      if (peer.authorized) peer.wire.send({ event: 'shutdown', data: { requested } })
    for (const [id, request] of gitPending) {
      clearTimeout(request.timer)
      request.reject(new Error('Mux stopped during Git operation.'))
      gitPending.delete(id)
    }
    clearInterval(timer)
    server.close()
    try {
      await Promise.all([serial, registrySerial])
      await agents.shutdown()
      await terminals.shutdown()
    } finally {
      await storage.worker.terminate()
      if (process.platform !== 'win32') await unlink(socketPath()).catch(() => {})
      releaseServer()
      for (const peer of peers) peer.wire.socket.destroy()
    }
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}
startServer().catch(async (error) => {
  const log = join(muxDirectory(), 'server.log')
  try {
    if ((await stat(log)).size > 1024 * 1024) await unlink(log)
  } catch {
    /* First startup. */
  }
  await appendFile(log, `${new Date().toISOString()} ${String(error)}\n`, { mode: 0o600 }).catch(
    () => {}
  )
  process.exit(1)
})
