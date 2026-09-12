import { existsSync } from 'node:fs'
import { userInfo, hostname } from 'node:os'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { Pane } from '@cerebro/core'
import {
  getCerebroHome,
  captureTerminalContinuation,
  restoreTerminalContinuation,
  type TerminalContinuation
} from '@cerebro/core'
import { StorageWorker } from './worker-client'
import { MuxError, type TerminalInfo, type TerminalSnapshot, type TerminalEvent } from './protocol'
import { VtBoundary } from './vt-boundary'
import { newShellSessionSequence } from './terminal-session'
import { TerminalColors, type SavedColors } from './terminal-colors'

type Context = { projectId: number; workspaceId: number; repositoryId: number | null; cwd: string }
type Saved = TerminalInfo & {
  colors?: SavedColors
  continuation?: TerminalContinuation
  data: string
  pending: string
  previousScreen?: string
  shell: string
  args: string[]
}
type Session = {
  info: TerminalInfo
  term: Terminal
  colors: TerminalColors
  serialize: SerializeAddon
  boundary: VtBoundary
  process?: pty.IPty
  batch?: { chunks: string[]; bytes: number }
  queue: Promise<void>
  bytes: number
  queued: number
  shell: string
  args: string[]
  previousScreen?: string
  replay: boolean
  lastCheckpoint: number
  persistenceError?: string
}
function defaultShell(): { file: string; args: string[] } {
  let file =
    process.env.SHELL ||
    userInfo().shell ||
    (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  if (process.platform === 'win32') file = process.env.COMSPEC || 'powershell.exe'
  return { file, args: ['bash', 'zsh', 'sh', 'fish'].includes(basename(file)) ? ['-l'] : [] }
}
function info(value: TerminalInfo): TerminalInfo {
  return {
    paneId: value.paneId,
    workspaceId: value.workspaceId,
    tabId: value.tabId,
    projectId: value.projectId,
    repositoryId: value.repositoryId,
    sessionId: value.sessionId,
    status: value.status,
    error: value.error,
    cols: value.cols,
    rows: value.rows,
    sequence: value.sequence,
    durableSequence: value.durableSequence,
    exitCode: value.exitCode,
    cwd: value.cwd
  }
}
export class Terminals {
  private sessions = new Map<number, Session>()
  has(paneId: number): boolean {
    return this.sessions.has(paneId) && !this.initializing.has(paneId)
  }
  private maintenance = false
  private initializing = new Map<number, Promise<Session>>()
  readonly scrollback = Math.min(
    100000,
    Math.max(0, Number(process.env.CEREBRO_SCROLLBACK ?? 10000))
  )
  constructor(
    private storage: StorageWorker,
    private emit: (event: TerminalEvent) => void
  ) {}
  private enqueue<T>(session: Session, action: () => Promise<T>): Promise<T> {
    // A control operation seals any pending output batch at its stream boundary.
    session.batch = undefined
    const result = session.queue.then(action)
    session.queue = result.then(
      () => {},
      () => {}
    )
    return result
  }
  private write(term: Terminal, data: string): Promise<void> {
    return new Promise((resolve) => term.write(data, resolve))
  }
  async ensure(workspaceId: number, tabId: number, pane: Pane, create = false): Promise<Session> {
    const pending = this.initializing.get(pane.id)
    if (pending) return pending
    const existing = this.sessions.get(pane.id)
    if (existing) return existing
    const initialization = this.initialize(workspaceId, tabId, pane, create)
    this.initializing.set(pane.id, initialization)
    try {
      return await initialization
    } catch (error) {
      this.sessions.get(pane.id)?.term.dispose()
      this.sessions.delete(pane.id)
      throw error
    } finally {
      this.initializing.delete(pane.id)
    }
  }
  private async initialize(
    workspaceId: number,
    tabId: number,
    pane: Pane,
    create: boolean
  ): Promise<Session> {
    const context = await this.storage.call<Context>('context', {
      workspaceId,
      repositoryId: pane.repositoryId
    })
    const loaded = await this.storage.call<{
      snapshot: Saved
      events: Array<TerminalEvent & { pending?: string }>
    } | null>('files.load', { paneId: pane.id })
    const term = new Terminal({
      cols: loaded?.snapshot.cols ?? 80,
      rows: loaded?.snapshot.rows ?? 24,
      scrollback: this.scrollback,
      allowProposedApi: true,
      cursorBlink: true,
      reflowCursorLine: false,
      convertEol: true
    })
    const serialize = new SerializeAddon()
    term.loadAddon(serialize)
    const shell = defaultShell()
    const colors = new TerminalColors(
      term,
      () => this.storage.call('terminal.theme', {}),
      (data) => {
        if (!session.replay) session.process?.write(data)
      },
      loaded?.snapshot.colors
    )
    await colors.syncTheme()
    const session: Session = {
      info: {
        ...context,
        tabId,
        paneId: pane.id,
        sessionId: randomUUID(),
        cols: term.cols,
        rows: term.rows,
        sequence: 0,
        status: 'interrupted'
      },
      term,
      serialize,
      colors,
      boundary: new VtBoundary(),
      queue: Promise.resolve(),
      bytes: 0,
      queued: 0,
      shell: loaded?.snapshot.shell ?? shell.file,
      args: loaded?.snapshot.args ?? shell.args,
      replay: true,
      lastCheckpoint: Date.now()
    }
    this.sessions.set(pane.id, session)
    term.onData((data) => {
      if (!session.replay) session.process?.write(data)
    })
    term.parser.registerOscHandler(7, (data) => {
      try {
        const url = new URL(data)
        if (
          url.protocol === 'file:' &&
          (!url.hostname || url.hostname === 'localhost' || url.hostname === hostname())
        )
          session.info.cwd = fileURLToPath(url)
      } catch {
        /* Unsupported CWD notification. */
      }
      return true
    })
    if (loaded) {
      session.info = {
        ...info(loaded.snapshot),
        ...context,
        cwd: loaded.snapshot.cwd,
        tabId,
        paneId: pane.id
      }
      session.previousScreen = loaded.snapshot.previousScreen
      await this.write(term, loaded.snapshot.data)
      if (loaded.snapshot.continuation)
        restoreTerminalContinuation(term, loaded.snapshot.continuation)
      session.boundary.pending = loaded.snapshot.pending || ''
      for (const event of loaded.events) {
        if (event.sequence <= session.info.sequence) continue
        if (event.sequence !== session.info.sequence + 1) break
        if (event.type === 'resize') term.resize(event.cols, event.rows)
        else if (event.type === 'data') await this.write(term, event.data || '')
        session.info = info(event)
        if (event.pending !== undefined) session.boundary.pending = event.pending
      }
      session.info.durableSequence = session.info.sequence
      if (session.info.status === 'running') session.info.status = 'interrupted'
    }
    session.replay = false
    if (create && !loaded) await this.launch(session)
    else if (!loaded) await this.checkpoint(session)
    return session
  }
  private async checkpoint(session: Session): Promise<void> {
    await session.colors.syncTheme()
    const saved: Saved = {
      ...session.info,
      colors: session.colors.save(),
      continuation: captureTerminalContinuation(session.term),
      data: session.serialize.serialize({ scrollback: this.scrollback }),
      pending: session.boundary.pending,
      previousScreen: session.previousScreen,
      shell: session.shell,
      args: session.args
    }
    await this.storage.call('files.checkpoint', saved)
    session.info.durableSequence = session.info.sequence
    session.bytes = 0
    session.lastCheckpoint = Date.now()
    session.persistenceError = undefined
  }
  private async record(session: Session, event: TerminalEvent): Promise<void> {
    session.bytes += Buffer.byteLength(JSON.stringify(event)) + 128
    try {
      await this.storage.call('files.append', {
        paneId: session.info.paneId,
        event: { ...event, pending: session.boundary.pending }
      })
      if (session.bytes > 4 * 1024 * 1024 || Date.now() - session.lastCheckpoint > 30000)
        await this.checkpoint(session)
    } catch (error) {
      session.persistenceError = `Terminal persistence failed: ${String(error)}`
      session.process?.pause()
      this.emit({ ...session.info, type: 'status', error: session.persistenceError })
    }
  }
  private async launch(session: Session): Promise<void> {
    if (session.process) session.process.kill()
    session.process = undefined
    if (session.term.buffer.active.type === 'alternate')
      session.previousScreen = session.colors.serialize() + session.serialize.serialize()
    if (session.info.sequence > 0) {
      session.replay = true
      await this.write(session.term, newShellSessionSequence(session.term.rows))
      session.replay = false
    }
    session.boundary.pending = ''
    session.info = {
      ...session.info,
      sessionId: randomUUID(),
      status: 'running',
      error: undefined,
      exitCode: undefined
    }
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) =>
          typeof value === 'string' && !key.startsWith('CEREBRO_') && !key.startsWith('ELECTRON_')
      )
    ) as Record<string, string>
    Object.assign(env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      CEREBRO_HOME: getCerebroHome(),
      CEREBRO_PROJECT_ID: String(session.info.projectId),
      CEREBRO_WORKSPACE_ID: String(session.info.workspaceId),
      CEREBRO_WORKSPACE_PATH: session.info.cwd,
      CEREBRO_TAB_ID: String(session.info.tabId),
      CEREBRO_PANE_ID: String(session.info.paneId)
    })
    if (process.env.CEREBRO_DB_PATH) env.CEREBRO_DB_PATH = process.env.CEREBRO_DB_PATH
    if (session.info.repositoryId) {
      env.CEREBRO_REPOSITORY_ID = String(session.info.repositoryId)
      env.CEREBRO_SUB_REPO_ID = String(session.info.repositoryId)
    }
    if (!existsSync(session.info.cwd)) {
      const context = await this.storage.call<Context>('context', {
        workspaceId: session.info.workspaceId,
        repositoryId: session.info.repositoryId
      })
      session.info.cwd = context.cwd
    }
    env.CEREBRO_WORKSPACE_PATH = (
      await this.storage.call<Context>('context', { workspaceId: session.info.workspaceId })
    ).cwd
    await this.checkpoint(session)
    try {
      const child = pty.spawn(session.shell, session.args, {
        cwd: session.info.cwd,
        env,
        cols: session.term.cols,
        rows: session.term.rows,
        name: 'xterm-256color'
      })
      session.process = child
      child.onData((data) => {
        const bytes = Buffer.byteLength(data)
        session.queued += bytes
        if (session.queued > 1024 * 1024) child.pause()
        if (session.batch && session.batch.bytes + bytes <= 256 * 1024) {
          session.batch.chunks.push(data)
          session.batch.bytes += bytes
          return
        }
        const batch = { chunks: [data], bytes }
        const drain = this.enqueue(session, async () => {
          if (session.batch === batch) session.batch = undefined
          if (session.process !== child) return
          const complete = session.boundary.take(batch.chunks.join(''))
          if (complete) await this.write(session.term, complete)
          session.info.sequence++
          const event: TerminalEvent = { ...session.info, type: 'data', data: complete }
          await this.record(session, event)
          this.emit(event)
        })
        session.batch = batch
        void drain
          .finally(() => {
            session.queued -= batch.bytes
            if (session.queued < 256 * 1024 && !session.persistenceError) child.resume()
          })
          .catch((error) => this.emit({ ...session.info, type: 'status', error: String(error) }))
      })
      child.onExit(({ exitCode }) => {
        void this.enqueue(session, async () => {
          if (session.process !== child) return
          session.process = undefined
          session.info.status = 'exited'
          session.info.exitCode = exitCode
          session.info.sequence++
          const event: TerminalEvent = { ...session.info, type: 'status' }
          await this.record(session, event)
          await this.checkpoint(session)
          this.emit(event)
        }).catch(() => {})
      })
    } catch (error) {
      session.info.status = 'failed'
      session.info.error = String(error)
      await this.checkpoint(session)
    }
  }
  async snapshot(paneId: number, activate = false): Promise<TerminalSnapshot> {
    const session = this.get(paneId)
    return this.enqueue(session, async () => {
      await session.colors.syncTheme()
      if (activate && session.info.status === 'interrupted') await this.launch(session)
      return {
        ...session.info,
        continuation: captureTerminalContinuation(session.term),
        scrollback: this.scrollback,
        data:
          session.colors.serialize() + session.serialize.serialize({ scrollback: this.scrollback }),
        previousScreen: session.previousScreen,
        error: session.persistenceError ?? session.info.error
      }
    })
  }
  async capture(paneId: number, rows = 0, format = 'text'): Promise<TerminalSnapshot> {
    if (
      !Number.isSafeInteger(rows) ||
      rows < 0 ||
      rows > this.scrollback ||
      !['text', 'ansi'].includes(format)
    )
      throw new MuxError('usage', 'Invalid capture options.')
    const session = this.get(paneId)
    return this.enqueue(session, async () => {
      if (format === 'ansi') await session.colors.syncTheme()
      const buffer = session.term.buffer.active
      const lines: string[] = []
      for (let i = Math.max(0, buffer.baseY - rows); i < buffer.baseY + session.term.rows; i++)
        lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
      return {
        ...session.info,
        error: session.persistenceError ?? session.info.error,
        data:
          format === 'ansi'
            ? session.colors.serialize() + session.serialize.serialize({ scrollback: rows })
            : lines.join('\n')
      }
    })
  }
  async restart(paneId: number): Promise<TerminalSnapshot> {
    const session = this.get(paneId)
    await this.enqueue(session, () => this.launch(session))
    this.emit({ ...session.info, type: 'status' })
    return this.snapshot(paneId)
  }
  input(paneId: number, generation: string, data: string): void {
    const session = this.get(paneId)
    if (!session.process || session.info.sessionId !== generation)
      throw new MuxError('conflict', 'Terminal is not running or session has changed.')
    if (typeof data !== 'string' || Buffer.byteLength(data) > 65536)
      throw new MuxError('usage', 'Input must be a string up to 64 KiB.')
    session.process.write(data)
  }
  async resize(paneId: number, generation: string, cols: number, rows: number): Promise<void> {
    if (
      ![cols, rows].every(Number.isSafeInteger) ||
      cols < 2 ||
      cols > 500 ||
      rows < 1 ||
      rows > 300
    )
      throw new MuxError('usage', 'Terminal size is out of range.')
    const session = this.get(paneId)
    await this.enqueue(session, async () => {
      if (session.info.sessionId !== generation) throw new MuxError('conflict', 'Session changed.')
      if (cols === session.term.cols && rows === session.term.rows) return
      session.term.resize(cols, rows)
      session.process?.resize(cols, rows)
      Object.assign(session.info, { cols, rows, sequence: session.info.sequence + 1 })
      const event: TerminalEvent = { ...session.info, type: 'resize' }
      await this.record(session, event)
      this.emit(event)
    })
  }
  private get(paneId: number): Session {
    const session = this.sessions.get(paneId)
    if (!session) throw new MuxError('not_found', 'Terminal pane not found.')
    return session
  }
  async stop(paneId: number, remove = false): Promise<void> {
    const session = this.sessions.get(paneId)
    if (session)
      await this.enqueue(session, async () => {
        const child = session.process
        session.process = undefined
        child?.kill()
        if (session.info.status === 'running') session.info.status = 'interrupted'
        if (!remove) {
          await this.checkpoint(session)
          this.emit({ ...session.info, type: 'status' })
        } else {
          session.term.dispose()
          this.sessions.delete(paneId)
        }
      })
    if (remove) await this.storage.call('files.remove', { paneId })
  }
  async flush(): Promise<void> {
    if (this.maintenance) return
    this.maintenance = true
    try {
      for (const session of this.sessions.values())
        if (session.persistenceError)
          await this.enqueue(session, async () => {
            await this.checkpoint(session)
            session.process?.resume()
            this.emit({ ...session.info, type: 'status' })
          })
      const watermarks = [...this.sessions.values()].map((session) => ({
        session,
        sequence: session.info.sequence
      }))
      await this.storage.call('files.flush')
      for (const { session, sequence } of watermarks)
        if (!session.persistenceError)
          session.info.durableSequence = Math.max(session.info.durableSequence ?? 0, sequence)
    } catch (error) {
      for (const session of this.sessions.values())
        this.emit({
          ...session.info,
          type: 'status',
          error: `Persistence delayed: ${String(error)}`
        })
    } finally {
      this.maintenance = false
    }
  }
  async shutdown(): Promise<void> {
    for (const id of this.sessions.keys()) await this.stop(id).catch(() => {})
    await this.storage.call('files.flush')
  }
}
