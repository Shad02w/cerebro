import { createConnection } from 'node:net'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, cp, rename, rm, open as openFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import { Wire, MuxError, VERSION, type Message } from './protocol'
import { protectDirectory } from './permissions'
import { log, rotateLog } from './log'
import { stopMuxDaemon } from './daemon-pid'
import { muxDirectory, socketPath, databasePath } from './paths'
import { readRuntimeManifest, runtimeOutdated, type RuntimeManifest } from './runtime-manifest'
export * from './protocol'
export { runtimeOutdated, type RuntimeManifest } from './runtime-manifest'
export { socketPath } from './paths'
export { log } from './log'
export {
  exportDiagnostics,
  defaultDiagnosticsName,
  redactDiagnostics,
  type DiagnosticsOptions,
  type DiagnosticsResult
} from './diagnostics'

export type ConnectOptions = { runtimeDir?: string; autoStart?: boolean }
export class MuxClient extends EventEmitter {
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private methods = new Map<string, string>()
  private constructor(readonly wire: Wire) {
    super()
    wire.on('message', (message: Message) => {
      if (message.event) {
        this.emit(message.event, message.data)
        return
      }
      const request = this.pending.get(message.id ?? '')
      if (!request) return
      clearTimeout(request.timer)
      this.pending.delete(message.id!)
      this.methods.delete(message.id!)
      if (message.error) request.reject(new MuxError(message.error.code, message.error.message))
      else request.resolve(message.result)
    })
    wire.on('close', () => {
      log('warn', 'client.disconnected', {
        pendingRequests: this.pending.size,
        pendingMethods: [...this.methods.values()].slice(0, 10)
      })
      this.methods.clear()
      for (const request of this.pending.values()) {
        clearTimeout(request.timer)
        request.reject(
          new MuxError('unavailable', 'Mux disconnected; operation may have completed.')
        )
      }
      this.pending.clear()
      this.emit('disconnected')
    })
  }
  static async open(): Promise<MuxClient> {
    const socket = createConnection(socketPath())
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy()
        log('warn', 'client.connect_timeout', { timeoutMs: 1000 })
        reject(new MuxError('unavailable', 'Mux connection timed out.'))
      }, 1000)
      socket.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    return new MuxClient(new Wire(socket))
  }
  request<T = unknown>(
    method: string,
    params: unknown = {},
    timeout = 120_000,
    requestId: string = randomUUID()
  ): Promise<T> {
    if (this.wire.socket.destroyed)
      return Promise.reject(new MuxError('unavailable', 'Mux is disconnected.'))
    const id = requestId
    if (this.pending.has(id))
      return Promise.reject(new MuxError('conflict', 'Request ID is already pending.'))
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.methods.delete(id)
        log('error', 'client.request_timeout', { method, timeoutMs: timeout })
        reject(
          new MuxError('unavailable', `Mux ${method} timed out; do not blindly repeat mutations.`)
        )
      }, timeout)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.methods.set(id, method)
      this.wire.send({ id, method, params })
    })
  }
  close(): void {
    this.wire.socket.destroy()
  }
}
function runtimeComplete(path: string): boolean {
  return [
    'mux.cjs',
    'mux-worker.cjs',
    process.platform === 'win32' ? 'node.exe' : 'node',
    'node_modules/node-pty/lib/index.js',
    'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'
  ].every((file) => existsSync(join(path, file)))
}
async function stageRuntime(source: string): Promise<string> {
  if (!runtimeComplete(source))
    throw new MuxError(
      'unavailable',
      'Mux runtime assets are incomplete. Rebuild Cerebro or repair the app installation.'
    )
  const manifest = await readFile(join(source, 'runtime.json'))
  const fingerprint = createHash('sha256').update(manifest).digest('hex').slice(0, 24)
  const target = join(muxDirectory(), 'runtimes', fingerprint)
  if (runtimeComplete(target)) return target
  if (existsSync(target)) await rm(target, { recursive: true, force: true })
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}-${randomUUID()}`
  try {
    await cp(source, temporary, { recursive: true })
    await rename(temporary, target)
  } catch (error) {
    if (!runtimeComplete(target)) throw error
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  return target
}
/**
 * A previous daemon compares this file byte for byte, including a trailing newline.
 * A current daemon ignores it, and nothing creates it.
 */
async function leftoverToken(): Promise<string | undefined> {
  try {
    const token = await readFile(join(muxDirectory(), 'token'), 'utf8')
    return token.trim().length > 0 ? token : undefined
  } catch {
    return undefined
  }
}
/** A pre-token daemon rejects hello when the file is gone or no longer matches. Stop that process. */
async function replaceUnauthorizedDaemon(): Promise<boolean> {
  const result = await stopMuxDaemon(socketPath(), join(muxDirectory(), 'runtimes'))
  if (!result.stopped) {
    log('warn', 'client.replace_unauthorized_skipped', { reason: result.reason })
    return false
  }
  log('warn', 'client.replace_unauthorized_host', { daemonPid: result.pid, forced: result.forced })
  return true
}
export async function connectMux(options: ConnectOptions = {}): Promise<MuxClient> {
  const created = await mkdir(muxDirectory(), { recursive: true, mode: 0o700 })
  if (created) await protectDirectory(muxDirectory())
  const token = await leftoverToken()
  const open = async (): Promise<{ client: MuxClient; runtime?: RuntimeManifest }> => {
    const client = await MuxClient.open()
    try {
      const reply = await client.request<{ runtime?: RuntimeManifest }>(
        'hello',
        { version: VERSION, ...(token ? { token } : {}), database: databasePath() },
        2000
      )
      return { client, runtime: reply?.runtime }
    } catch (error) {
      client.close()
      throw error
    }
  }
  let running: { client: MuxClient; runtime?: RuntimeManifest } | undefined
  try {
    running = await open()
  } catch (error) {
    const code = error instanceof MuxError ? error.code : (error as NodeJS.ErrnoException).code
    // A missing socket is the normal "not started yet" case; anything else is worth a record.
    if (code !== 'ENOENT' && code !== 'ECONNREFUSED')
      log('warn', 'client.connect_failed', { error, autoStart: options.autoStart !== false })
    // Build 17 stopped sending a secret. A daemon from the previous release still requires
    // mux/token and answers hello with unauthorized, which used to trap the app on the splash.
    const replace =
      error instanceof MuxError && error.code === 'unauthorized' && options.autoStart !== false
    if (replace) {
      if (!(await replaceUnauthorizedDaemon())) throw error
    } else if (error instanceof MuxError && error.code !== 'unavailable') throw error
    else if (options.autoStart === false) throw new MuxError('unavailable', 'Mux is not running.')
  }
  const source =
    options.runtimeDir ??
    process.env.CEREBRO_MUX_RUNTIME ??
    [
      __dirname,
      resolve(__dirname, '../../../desktop/out/cli'),
      resolve(__dirname, '../../../apps/desktop/out/cli')
    ].find((path) => existsSync(join(path, 'mux.cjs')))
  if (running) {
    const local =
      source && options.autoStart !== false ? await readRuntimeManifest(source) : undefined
    if (!runtimeOutdated(local, running.runtime)) return running.client
    log('info', 'client.replace_outdated_host', {
      running: running.runtime?.muxHash,
      local: local?.muxHash
    })
    // This build is newer than the host: stop it and start the staged runtime. Terminals keep
    // their output and start fresh shells on activation; other clients reconnect on their own.
    await running.client.request('server.stop', {}, 5000).catch(() => {})
    running.client.close()
    let stopped = false
    for (let attempt = 0; attempt < 1200 && !stopped; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      try {
        ;(await MuxClient.open()).close()
      } catch {
        stopped = true
      }
    }
    if (!stopped) {
      log('error', 'client.host_still_stopping', {})
      throw new MuxError('unavailable', 'The previous mux host is still stopping. Retry shortly.')
    }
  }
  if (!source) {
    log('error', 'client.runtime_missing', {})
    throw new MuxError(
      'unavailable',
      'Mux runtime missing. Build Cerebro or repair the CLI installation.'
    )
  }
  const runtime = await stageRuntime(source)
  const logPath = join(muxDirectory(), 'server.log')
  rotateLog()
  const stderr = await openFile(logPath, 'a', 0o600)
  log('info', 'client.spawn_daemon', { runtime: runtime.split(/[\\/]/).pop() })
  const child = spawn(
    join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'),
    ['--no-warnings', join(runtime, 'mux.cjs')],
    {
      detached: true,
      stdio: ['ignore', 'ignore', stderr.fd],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, CEREBRO_MUX_RUNTIME: runtime }
    }
  )
  let startupError: Error | undefined
  child.on('error', (error) => {
    startupError = error
    log('error', 'client.spawn_failed', { error })
  })
  child.on('exit', (code, signal) => {
    if (code !== 0) log('error', 'client.daemon_exited', { code, signal, daemonPid: child.pid })
  })
  child.unref()
  await stderr.close()
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (startupError) throw startupError
    try {
      return (await open()).client
    } catch (error) {
      if (error instanceof MuxError && error.code !== 'unavailable') throw error
    }
  }
  log('error', 'client.start_timeout', { daemonPid: child.pid, waitedMs: 5000 })
  throw new MuxError('unavailable', 'Mux failed to start. Check mux/server.log in CEREBRO_HOME.')
}
export async function muxRequest<T>(method: string, params: unknown = {}): Promise<T> {
  const client = await connectMux()
  try {
    return await client.request<T>(method, params)
  } finally {
    client.close()
  }
}
