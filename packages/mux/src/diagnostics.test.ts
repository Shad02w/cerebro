import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { crc32, inflateRawSync } from 'node:zlib'
import { connectMux } from './client'
import { defaultDiagnosticsName, exportDiagnostics, redactDiagnostics } from './diagnostics'
import { createZip } from './zip'

const exec = promisify(execFile)

/** Independent reader: walks the central directory the way an unzip tool does. */
function readZip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, 'end of central directory')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, string>()
  for (let index = 0; index < count; index++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50)
    const method = zip.readUInt16LE(at + 10)
    const checksum = zip.readUInt32LE(at + 16)
    const packed = zip.readUInt32LE(at + 20)
    const raw = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const extra = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    assert.equal(zip.readUInt32LE(local), 0x04034b50)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const body = zip.subarray(start, start + packed)
    const data = method === 8 ? inflateRawSync(body) : body
    assert.equal(data.length, raw)
    assert.equal(crc32(data), checksum, `crc of ${name}`)
    files.set(name, data.toString('utf8'))
    at += 46 + nameLength + extra
  }
  return files
}

test('zip round-trips text, unicode names and stored/deflated entries', async () => {
  const zip = createZip([
    { name: 'a.txt', data: 'hello '.repeat(500) },
    { name: 'logs/ünï.json', data: '{"ok":true}' },
    { name: 'empty.txt', data: '' }
  ])
  const files = readZip(zip)
  assert.equal(files.get('a.txt'), 'hello '.repeat(500))
  assert.equal(files.get('logs/ünï.json'), '{"ok":true}')
  assert.equal(files.get('empty.txt'), '')
  assert.throws(() => createZip([{ name: '../escape', data: 'x' }]), /Invalid zip entry/)
  assert.throws(() => createZip([{ name: '/abs', data: 'x' }]), /Invalid zip entry/)
  // The system unzip is the real compatibility check; skip where it is unavailable.
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-zip-'))
  try {
    await writeFile(join(directory, 'x.zip'), zip)
    await exec('unzip', ['-tq', join(directory, 'x.zip')]).then(
      (result) => assert.match(result.stdout, /No errors/),
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      }
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('redaction rewrites home paths and scrubs credential shapes', () => {
  const previous = process.env.CEREBRO_HOME
  process.env.CEREBRO_HOME = join(homedir(), 'cerebro-data')
  try {
    const text = [
      `opened ${join(homedir(), 'cerebro-data', 'mux', 'server.log')}`,
      `stack at ${join(homedir(), 'dev', 'secret-project', 'index.ts')}:1`,
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'Authorization: Bearer abcdefghijklmnop1234',
      '{"password":"hunter2hunter2"}',
      'clone https://alice:s3cretpass@github.com/acme/repo.git',
      'daemon token 11111111-2222-3333-4444-555555555555'
    ].join('\n')
    const result = redactDiagnostics(text, ['11111111-2222-3333-4444-555555555555'])
    // Windows keeps the `\` that follows the rewritten prefix.
    const portable = result.replaceAll('\\', '/')
    assert.ok(portable.includes('$CEREBRO_HOME/mux/server.log'), result)
    assert.ok(portable.includes('~/dev/secret-project/index.ts'), result)
    assert.ok(!result.includes(homedir()), result)
    for (const secret of ['ghp_abc', 'abcdefghijklmnop1234', 'hunter2', 's3cretpass', '1111-'])
      assert.ok(!result.includes(secret), `${secret} leaked: ${result}`)
  } finally {
    if (previous === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previous
  }
})

test('default file name is a sortable timestamp', () => {
  assert.equal(
    defaultDiagnosticsName(new Date(2026, 9, 16, 13, 5, 9)),
    'cerebro-diagnostics-20261016-130509.zip'
  )
})

test('export bundles redacted logs and system info even when the mux is down', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cerebro-diag-'))
  const previous = process.env.CEREBRO_HOME
  process.env.CEREBRO_HOME = home
  try {
    await mkdir(join(home, 'mux'), { recursive: true })
    await writeFile(
      join(home, 'mux', 'server.log'),
      `${JSON.stringify({ event: 'request.failed', error: `boom at ${homedir()}/dev/x.ts`, note: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789' })}\n`
    )
    await writeFile(join(home, 'mux', 'server.log.1'), '{"event":"older"}\n')
    // Terminal content must never be bundled, whatever it holds.
    await mkdir(join(home, 'mux', 'terminals', '7'), { recursive: true })
    await writeFile(join(home, 'mux', 'terminals', '7', '1.snapshot'), 'TOP-SECRET-TERMINAL-TEXT')

    const result = await exportDiagnostics({
      outputPath: home,
      app: { version: '9.9.9', packaged: false },
      skipMux: true
    })
    assert.match(result.path, /cerebro-diagnostics-\d{8}-\d{6}\.zip$/)
    assert.equal((await stat(result.path)).size, result.bytes)
    const files = readZip(await readFile(result.path))
    assert.deepEqual([...files.keys()].sort(), [
      'README.txt',
      'layout-summary.json',
      'logs/server.log',
      'logs/server.log.1',
      'system.json'
    ])
    const system = JSON.parse(files.get('system.json')!)
    assert.equal(system.app.version, '9.9.9')
    assert.equal(system.bundleVersion, 1)
    assert.equal(system.os.platform, process.platform)
    assert.equal(system.environment.home, '$CEREBRO_HOME')
    assert.equal(system.storage.terminals.files, 1)
    assert.deepEqual(system.ownership, { recorded: false })
    assert.match(files.get('logs/server.log')!, /boom at ~\/dev\/x\.ts/)
    const everything = [...files.values()].join('\n')
    assert.ok(!everything.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'))
    assert.ok(!everything.includes('TOP-SECRET-TERMINAL-TEXT'))
    assert.ok(!everything.includes(home))

    // A bare file name gets the .zip suffix.
    const named = await exportDiagnostics({ outputPath: join(home, 'report'), skipMux: true })
    assert.equal(named.path, join(home, 'report.zip'))
  } finally {
    if (previous === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test(
  'export describes a live daemon without leaking names, then a stopped one',
  { timeout: 60000, skip: process.platform === 'win32' },
  async () => {
    const runtimeDir = resolve(__dirname, '../../../apps/desktop/out/cli')
    const home = await mkdtemp(join(tmpdir(), 'cerebro-diag-live-'))
    const folder = join(home, 'very-private-folder-name')
    await mkdir(folder)
    const previous = { home: process.env.CEREBRO_HOME, shell: process.env.SHELL }
    process.env.CEREBRO_HOME = home
    process.env.SHELL = '/bin/sh'
    delete process.env.CEREBRO_DB_PATH
    let running = false
    try {
      const client = await connectMux({ runtimeDir })
      running = true
      await client.request('registry', { action: 'project.createDirectory', directory: folder })
      client.close()

      const live = await exportDiagnostics({ outputPath: join(home, 'live.zip') })
      assert.equal(live.muxRunning, true)
      const liveFiles = readZip(await readFile(live.path))
      const system = JSON.parse(liveFiles.get('system.json')!)
      assert.equal(system.mux.running, true)
      assert.equal(typeof system.mux.pid, 'number')
      assert.equal(system.ownership.recorded, true)
      assert.equal(system.ownership.alive, true)
      assert.equal(system.ownership.reachable, true)
      assert.ok(system.runtimes.length >= 1)
      const layout = JSON.parse(liveFiles.get('layout-summary.json')!)
      assert.equal(layout.projects, 1)
      assert.equal(layout.workspaces, 1)
      assert.equal(layout.workspacesMissingOnDisk, 0)
      assert.deepEqual(layout.projectKinds, { directory: 1 })
      assert.match(liveFiles.get('logs/server.log')!, /"event":"server\.listening"/)
      assert.ok(![...liveFiles.values()].join('\n').includes('very-private-folder-name'))

      const stopper = await connectMux({ autoStart: false })
      const gone = new Promise((resolve) => stopper.once('disconnected', resolve))
      await stopper.request('server.stop')
      await gone
      running = false
      const down = await exportDiagnostics({ outputPath: join(home, 'down.zip') })
      assert.equal(down.muxRunning, false)
      const downFiles = readZip(await readFile(down.path))
      const downSystem = JSON.parse(downFiles.get('system.json')!)
      assert.equal(downSystem.mux.running, false)
      assert.equal(downSystem.mux.error.code, 'unavailable')
      assert.match(downFiles.get('layout-summary.json')!, /not reachable/)
      // The bundle still carries the daemon's own account of its shutdown.
      assert.match(downFiles.get('logs/server.log')!, /"event":"server\.stopped"/)
    } finally {
      if (running) {
        const client = await connectMux({ autoStart: false }).catch(() => undefined)
        await client?.request('server.stop').catch(() => {})
        client?.close()
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (previous.home === undefined) delete process.env.CEREBRO_HOME
      else process.env.CEREBRO_HOME = previous.home
      if (previous.shell === undefined) delete process.env.SHELL
      else process.env.SHELL = previous.shell
      await rm(home, { recursive: true, force: true })
    }
  }
)
