import { createConnection } from 'node:net'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  rename,
  rm,
  link,
  open as openFile,
  stat
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import { Wire, MuxError, VERSION, type Message } from './protocol'
import { protectDirectory } from './permissions'
import { muxDirectory, socketPath, databasePath } from './paths'
export * from './protocol'
export { socketPath } from './paths'

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
      if (message.error) request.reject(new MuxError(message.error.code, message.error.message))
      else request.resolve(message.result)
    })
    wire.on('close', () => {
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
        reject(
          new MuxError('unavailable', `Mux ${method} timed out; do not blindly repeat mutations.`)
        )
      }, timeout)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
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
    'node_modules/node-pty/lib/index.js'
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
export async function connectMux(options: ConnectOptions = {}): Promise<MuxClient> {
  const created = await mkdir(muxDirectory(), { recursive: true, mode: 0o700 })
  if (created) await protectDirectory(muxDirectory())
  const tokenPath = join(muxDirectory(), 'token')
  if (!existsSync(tokenPath)) {
    await protectDirectory(muxDirectory())
    const temporary = `${tokenPath}-${randomUUID()}`
    try {
      await writeFile(temporary, randomUUID(), { flag: 'wx', mode: 0o600 })
      try {
        await link(temporary, tokenPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    } finally {
      await rm(temporary, { force: true })
    }
  }
  const token = await readFile(tokenPath, 'utf8')
  const open = async (): Promise<MuxClient> => {
    const client = await MuxClient.open()
    try {
      await client.request('hello', { version: VERSION, token, database: databasePath() }, 2000)
      return client
    } catch (error) {
      client.close()
      throw error
    }
  }
  try {
    return await open()
  } catch (error) {
    if (error instanceof MuxError && error.code !== 'unavailable') throw error
    if (options.autoStart === false) throw new MuxError('unavailable', 'Mux is not running.')
  }
  const source =
    options.runtimeDir ??
    process.env.CEREBRO_MUX_RUNTIME ??
    [
      __dirname,
      resolve(__dirname, '../../../desktop/out/cli'),
      resolve(__dirname, '../../../apps/desktop/out/cli')
    ].find((path) => existsSync(join(path, 'mux.cjs')))
  if (!source)
    throw new MuxError(
      'unavailable',
      'Mux runtime missing. Build Cerebro or repair the CLI installation.'
    )
  const runtime = await stageRuntime(source)
  const logPath = join(muxDirectory(), 'server.log')
  try {
    if ((await stat(logPath)).size > 1024 * 1024) await rm(logPath)
  } catch {
    /* New log. */
  }
  const log = await openFile(logPath, 'a', 0o600)
  const child = spawn(
    join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'),
    ['--no-warnings', join(runtime, 'mux.cjs')],
    {
      detached: true,
      stdio: ['ignore', 'ignore', log.fd],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, CEREBRO_MUX_RUNTIME: runtime }
    }
  )
  let startupError: Error | undefined
  child.on('error', (error) => {
    startupError = error
  })
  child.unref()
  await log.close()
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (startupError) throw startupError
    try {
      return await open()
    } catch (error) {
      if (error instanceof MuxError && error.code !== 'unavailable') throw error
    }
  }
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
