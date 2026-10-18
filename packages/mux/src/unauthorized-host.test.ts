import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { connectMux, socketPath, type MuxClient } from './client'
import { isMuxDaemonCommand, socketPidsFromLsof, stopMuxDaemon } from './daemon-pid'

const legacyDaemon = `
const { createServer } = require('node:net')
const { readFileSync, chmodSync, unlinkSync } = require('node:fs')
const { join } = require('node:path')
const path = process.env.MUX_SOCK
let token
try {
  token = readFileSync(join(process.env.CEREBRO_HOME, 'mux', 'token'), 'utf8')
} catch {
  token = undefined
}
try { unlinkSync(path) } catch {}
const send = (socket, message) => {
  const payload = Buffer.from(JSON.stringify(message))
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length)
  socket.write(header)
  socket.write(payload)
}
const server = createServer((socket) => {
  let buffer = Buffer.alloc(0)
  let parts = []
  let bytes = 0
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const header = buffer.readUInt32BE(0)
      const size = header & 0x7fffffff
      if (buffer.length < size + 4) break
      parts.push(buffer.subarray(4, size + 4))
      bytes += size
      buffer = buffer.subarray(size + 4)
      if (header >>> 31) continue
      const data = Buffer.concat(parts, bytes)
      parts = []
      bytes = 0
      const message = JSON.parse(data.toString('utf8'))
      const params = message.params || {}
      if (message.method === 'hello') {
        if (params.token !== token) {
          send(socket, {
            id: message.id,
            error: { code: 'unauthorized', message: 'Mux authentication failed.' }
          })
          return
        }
        send(socket, {
          id: message.id,
          result: {
            epoch: 'old',
            version: 2,
            pid: process.pid,
            runtime: { muxHash: 'legacy-compat', builtAt: 1 }
          }
        })
        return
      }
      if (message.method === 'server.status') {
        send(socket, { id: message.id, result: { running: true, pid: process.pid } })
        return
      }
      if (message.method === 'server.stop') {
        send(socket, { id: message.id, result: { stopped: true } })
        setTimeout(() => process.exit(0), 30)
        return
      }
      send(socket, { id: message.id, error: { code: 'usage', message: 'unknown' } })
    }
  })
})
server.listen(path, () => {
  try { chmodSync(path, 0o600) } catch {}
  console.log('ready')
})
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
`

const currentDaemon = `
const { createServer } = require('node:net')
const { chmodSync, unlinkSync } = require('node:fs')
const path = process.env.MUX_SOCK
try { unlinkSync(path) } catch {}
const send = (socket, message) => {
  const payload = Buffer.from(JSON.stringify(message))
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length)
  socket.write(header)
  socket.write(payload)
}
const server = createServer((socket) => {
  let buffer = Buffer.alloc(0)
  let parts = []
  let bytes = 0
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const header = buffer.readUInt32BE(0)
      const size = header & 0x7fffffff
      if (buffer.length < size + 4) break
      parts.push(buffer.subarray(4, size + 4))
      bytes += size
      buffer = buffer.subarray(size + 4)
      if (header >>> 31) continue
      const data = Buffer.concat(parts, bytes)
      parts = []
      bytes = 0
      const message = JSON.parse(data.toString('utf8'))
      if (message.method === 'hello' || message.method === 'server.status') {
        send(socket, {
          id: message.id,
          result: { epoch: 'new', version: 2, running: true, pid: process.pid }
        })
        return
      }
      if (message.method === 'server.stop') {
        send(socket, { id: message.id, result: { stopped: true } })
        setTimeout(() => process.exit(0), 30)
        return
      }
      send(socket, { id: message.id, error: { code: 'usage', message: 'unknown' } })
    }
  })
})
server.listen(path, () => {
  try { chmodSync(path, 0o600) } catch {}
  console.log('ready')
})
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
`

function alive(pid: number | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
}

async function startDaemon(script: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [script], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`daemon did not listen: ${output}`)), 5000)
    const onData = (chunk: Buffer): void => {
      output += chunk.toString()
      if (!output.includes('ready')) return
      clearTimeout(timer)
      resolve()
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`daemon exited before listen (${code ?? signal}): ${output}`))
    })
  })
  return child
}

async function fixtureRuntime(home: string): Promise<string> {
  const runtime = join(home, 'runtime')
  await mkdir(join(runtime, 'node_modules/node-pty/lib'), { recursive: true })
  await mkdir(join(runtime, 'node_modules/@anthropic-ai/claude-agent-sdk'), { recursive: true })
  await writeFile(join(runtime, 'mux-worker.cjs'), '')
  await writeFile(join(runtime, 'mux.cjs'), currentDaemon)
  await writeFile(join(runtime, 'node_modules/node-pty/lib/index.js'), '')
  await writeFile(join(runtime, 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'), '')
  await writeFile(
    join(runtime, 'node'),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
    {
      mode: 0o755
    }
  )
  await chmod(join(runtime, 'node'), 0o755)
  await writeFile(
    join(runtime, 'runtime.json'),
    JSON.stringify({ muxHash: 'legacy-compat', builtAt: 1, version: 'test' })
  )
  return runtime
}

async function withHome(run: (home: string, runtime: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'cerebro-mux-unauth-'))
  const previousHome = process.env.CEREBRO_HOME
  const previousSock = process.env.MUX_SOCK
  process.env.CEREBRO_HOME = home
  process.env.MUX_SOCK = socketPath()
  try {
    await run(home, await fixtureRuntime(home))
  } finally {
    if (previousHome === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previousHome
    if (previousSock === undefined) delete process.env.MUX_SOCK
    else process.env.MUX_SOCK = previousSock
    await rm(home, { recursive: true, force: true })
  }
}

async function stopClient(client: MuxClient | undefined): Promise<void> {
  if (!client) return
  const gone = new Promise((resolve) => client.once('disconnected', resolve))
  await client.request('server.stop').catch(() => {})
  await gone
  client.close()
}

test('isMuxDaemonCommand matches only the daemon entry', () => {
  assert.equal(isMuxDaemonCommand('/opt/cerebro/mux.cjs'), true)
  assert.equal(isMuxDaemonCommand('/usr/bin/node\0--no-warnings\0/opt/runtimes/ab/mux.cjs\0'), true)
  assert.equal(isMuxDaemonCommand('node --no-warnings C:\\\\cerebro\\\\mux.cjs'), true)
  assert.equal(isMuxDaemonCommand('/opt/cerebro/mux-worker.cjs'), false)
  assert.equal(isMuxDaemonCommand('/opt/cerebro/holder.cjs'), false)
  assert.equal(isMuxDaemonCommand('notmux.cjs'), false)
})

test('lsof field output identifies the process holding the socket', () => {
  const sock = '/var/folders/ab/T/cerebro-501-abc.sock'
  const output = [
    'p10',
    'n/private/var/folders/ab/T/cerebro-501-abc.sock',
    'p11',
    'n/private/var/folders/ab/T/cerebro-501-abc.sock type=STREAM',
    'n/private/var/folders/ab/T/cerebro-501-abc.sock type=STREAM',
    'p12',
    'n/tmp/other.sock type=STREAM',
    ''
  ].join('\n')
  assert.deepEqual(socketPidsFromLsof(output, sock), [10, 11])
  assert.deepEqual(
    socketPidsFromLsof('p4\nn->/tmp/cerebro-1-ab.sock\n', '/tmp/cerebro-1-ab.sock'),
    [4]
  )
})

test(
  'a previous daemon that rejects the removed handshake token is replaced',
  { timeout: 30000, skip: process.platform === 'win32' },
  async () => {
    await withHome(async (home, runtime) => {
      await mkdir(join(home, 'mux'), { recursive: true })
      await writeFile(join(home, 'mux', 'token'), 'secret-loaded-at-start')
      const legacy = await startDaemon(await writeLegacy(home, 'mux.cjs'))
      await rm(join(home, 'mux', 'token'))
      let client: MuxClient | undefined
      try {
        client = await connectMux({ runtimeDir: runtime })
        const status = await client.request<{ pid: number }>('server.status')
        assert.notEqual(status.pid, legacy.pid)
        assert.equal(alive(legacy.pid), false)
        const text = await readFile(join(home, 'mux', 'server.log'), 'utf8')
        assert.match(text, /client.replace_unauthorized_host/)
        assert.match(text, new RegExp(`"daemonPid":${legacy.pid}`))
      } finally {
        await stopClient(client)
        await stopChild(legacy)
      }
    })
  }
)

test(
  'a leftover token is sent unchanged, including a trailing newline',
  { timeout: 30000, skip: process.platform === 'win32' },
  async () => {
    await withHome(async (home, runtime) => {
      await mkdir(join(home, 'mux'), { recursive: true })
      await writeFile(join(home, 'mux', 'token'), 'secret-loaded-at-start\n')
      const legacy = await startDaemon(await writeLegacy(home, 'mux.cjs'))
      let client: MuxClient | undefined
      try {
        client = await connectMux({ runtimeDir: runtime })
        const status = await client.request<{ pid: number }>('server.status')
        assert.equal(status.pid, legacy.pid)
        assert.equal(alive(legacy.pid), true)
      } finally {
        await stopClient(client)
        await stopChild(legacy)
      }
    })
  }
)

test(
  'diagnostics do not stop a daemon that rejects the handshake',
  { timeout: 30000, skip: process.platform === 'win32' },
  async () => {
    await withHome(async (home) => {
      await mkdir(join(home, 'mux'), { recursive: true })
      await writeFile(join(home, 'mux', 'token'), 'secret-loaded-at-start')
      const legacy = await startDaemon(await writeLegacy(home, 'mux.cjs'))
      await rm(join(home, 'mux', 'token'))
      try {
        await assert.rejects(connectMux({ autoStart: false }), /Mux authentication failed/)
        assert.equal(alive(legacy.pid), true)
      } finally {
        await stopChild(legacy)
      }
    })
  }
)

test(
  'a socket held by something other than mux.cjs is not killed',
  { timeout: 30000, skip: process.platform === 'win32' },
  async () => {
    await withHome(async (home, runtime) => {
      await mkdir(join(home, 'mux'), { recursive: true })
      await writeFile(join(home, 'mux', 'token'), 'secret-loaded-at-start')
      const holder = await startDaemon(await writeLegacy(home, 'holder.cjs'))
      await rm(join(home, 'mux', 'token'))
      try {
        await assert.rejects(
          connectMux({ runtimeDir: runtime }),
          (error: Error) => error.message === 'Mux authentication failed.'
        )
        assert.equal(alive(holder.pid), true)
      } finally {
        await stopChild(holder)
      }
    })
  }
)

test(
  'a staged daemon is found by its runtime path when the socket holder cannot be read',
  { timeout: 30000, skip: process.platform === 'win32' },
  async () => {
    await withHome(async (home) => {
      await mkdir(join(home, 'mux', 'runtimes', 'abc'), { recursive: true })
      const staged = await startDaemon(
        await writeLegacy(join(home, 'mux', 'runtimes', 'abc'), 'mux.cjs')
      )
      const elsewhere = await startDaemon(await writeLegacy(home, 'mux.cjs'))
      try {
        const missingSocket = join(home, 'missing.sock')
        // Without a runtimes directory nothing identifies either process.
        assert.equal((await stopMuxDaemon(missingSocket)).stopped, false)
        assert.equal(alive(staged.pid), true)
        const result = await stopMuxDaemon(missingSocket, join(home, 'mux', 'runtimes'))
        assert.equal(result.stopped, true)
        assert.equal(alive(staged.pid), false)
        // A mux.cjs outside this home's runtimes is never taken by path alone.
        assert.equal(alive(elsewhere.pid), true)
      } finally {
        await stopChild(staged)
        await stopChild(elsewhere)
      }
    })
  }
)

async function writeLegacy(home: string, name: string): Promise<string> {
  const script = join(home, name)
  await writeFile(script, legacyDaemon)
  return script
}
