import { homedir } from 'node:os'
import { JsonProcess, executable, type Frame } from './transport'

type ThreadHandler = (frame: Frame) => void
type ExitHandler = (error: Error) => void

/**
 * One long-lived `codex app-server` for every Codex thread.
 * Session close detaches a thread. Only `stop` ends the process.
 */
class CodexAppServer {
  private rpc: JsonProcess | undefined
  /** Set only after initialize completes, so requests cannot race the handshake. */
  private ready: JsonProcess | undefined
  private pending: Promise<JsonProcess> | undefined
  private threads = new Map<string, ThreadHandler>()
  private exits = new Set<ExitHandler>()
  /** Frames that arrived before the caller subscribed, keyed by thread id. */
  private queued = new Map<string, Frame[]>()
  private stopping = false
  /** A crash may restart the process once. A second immediate death waits for the next request. */
  private allowRestart = true

  pid(): number | undefined {
    return (this.ready ?? this.rpc)?.child.pid
  }

  hasProcess(): boolean {
    return this.ready !== undefined && !this.stopping
  }

  async request(method: string, params: Frame = {}): Promise<Frame> {
    const rpc = await this.connection()
    const result = await rpc.request(method, params)
    this.allowRestart = true
    return result
  }

  /** Best-effort. Does not start a server that is not already running. */
  interrupt(threadId: string, turnId: string): void {
    if (!this.hasProcess()) return
    void this.request('turn/interrupt', { threadId, turnId }).catch(() => {})
  }

  send(frame: Frame): void {
    try {
      this.rpc?.send(frame)
    } catch {
      // The process is already gone; the exit handler reports it.
    }
  }

  /**
   * Receives frames for `threadId`, including any that arrived since the thread was opened.
   * Returns an unsubscribe function.
   */
  subscribe(threadId: string, handler: ThreadHandler): () => void {
    this.threads.set(threadId, handler)
    const queued = this.queued.get(threadId)
    if (queued) {
      this.queued.delete(threadId)
      for (const frame of queued) handler(frame)
    }
    return () => {
      if (this.threads.get(threadId) === handler) this.threads.delete(threadId)
    }
  }

  onExit(handler: ExitHandler): () => void {
    this.exits.add(handler)
    return () => this.exits.delete(handler)
  }

  stop(): void {
    this.stopping = true
    this.allowRestart = false
    this.pending = undefined
    this.queued.clear()
    this.threads.clear()
    this.exits.clear()
    const rpc = this.rpc
    this.rpc = undefined
    this.ready = undefined
    if (!rpc) return
    rpc.onExit = () => {}
    rpc.onFrame = () => {}
    rpc.close()
  }

  private connection(): Promise<JsonProcess> {
    if (this.stopping) return Promise.reject(new Error('Codex app-server is stopped.'))
    if (this.ready) return Promise.resolve(this.ready)
    if (!this.pending) {
      const attempt = this.start()
      this.pending = attempt
      void attempt.then(
        () => {},
        () => {
          if (this.pending === attempt) this.pending = undefined
        }
      )
    }
    return this.pending
  }

  private async start(): Promise<JsonProcess> {
    if (this.stopping) throw new Error('Codex app-server is stopped.')
    const rpc = new JsonProcess(executable('codex'), ['app-server'], homedir())
    this.rpc = rpc
    try {
      if (this.stopping) throw new Error('Codex app-server is stopped.')
      await rpc.request('initialize', {
        clientInfo: { name: 'cerebro', title: 'Cerebro', version: '0.1.0' },
        capabilities: { experimentalApi: true }
      })
      if (this.rpc !== rpc || this.stopping) throw new Error('Codex app-server is stopped.')
      rpc.send({ method: 'initialized', params: {} })
      rpc.onFrame = (frame) => this.deliver(frame)
      rpc.onExit = (error) => this.onProcessExit(rpc, error)
      this.ready = rpc
      return rpc
    } catch (error) {
      if (this.rpc === rpc) this.rpc = undefined
      rpc.onExit = () => {}
      rpc.close()
      throw error
    }
  }

  private deliver(frame: Frame): void {
    const params: Frame = frame.params ?? {}
    const threadId = typeof params.threadId === 'string' ? params.threadId : undefined
    const request = frame.id != null && Boolean(frame.method)
    if (!threadId) {
      if (frame.method === 'error') {
        for (const handler of this.threads.values()) this.safe(handler, frame)
        return
      }
      if (request) this.decline(frame.id, 'No Codex thread is waiting on this request.')
      return
    }
    const handler = this.threads.get(threadId)
    if (handler) {
      this.safe(handler, frame)
      return
    }
    const queue = this.queued.get(threadId) ?? []
    queue.push(frame)
    const dropped = queue.length > 50 ? queue.shift() : undefined
    this.queued.set(threadId, queue)
    if (dropped?.id != null && dropped.method)
      this.decline(dropped.id, 'No Codex thread is waiting on this request.')
  }

  private safe(handler: ThreadHandler, frame: Frame): void {
    try {
      handler(frame)
    } catch {
      // The session reports its own failure.
    }
  }

  private decline(id: unknown, message: string): void {
    this.send({ id, error: { code: -32000, message } })
  }

  private onProcessExit(rpc: JsonProcess, error: Error): void {
    if (this.rpc !== rpc && this.ready !== rpc) return
    this.rpc = undefined
    this.ready = undefined
    this.pending = undefined
    this.queued.clear()
    this.threads.clear()
    const exits = [...this.exits]
    this.exits.clear()
    for (const exit of exits) exit(error)
    if (this.stopping || !this.allowRestart) return
    this.allowRestart = false
    void this.connection().catch(() => {})
  }
}

let shared: CodexAppServer | undefined

export function codexAppServer(): CodexAppServer {
  return (shared ??= new CodexAppServer())
}

export function codexAppServerPid(): number | undefined {
  return shared?.pid()
}

/** Interrupts a turn on the running server. A stopped server is left stopped. */
export function interruptCodexTurn(threadId: string, turnId: string): void {
  shared?.interrupt(threadId, turnId)
}

export function stopCodexAppServer(): void {
  shared?.stop()
  shared = undefined
}
