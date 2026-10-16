import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { log, logPath, rotateLog } from './log'

const records = async (): Promise<Array<Record<string, unknown>>> =>
  (await readFile(logPath(), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

test('log appends one JSON record per line and flattens errors', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cerebro-log-'))
  const previous = process.env.CEREBRO_HOME
  process.env.CEREBRO_HOME = home
  try {
    rotateLog()
    log('info', 'peer.connect', { peer: 1 })
    log('error', 'request.failed', {
      method: 'registry',
      error: Object.assign(new Error('boom'), { code: 'EPIPE' }),
      huge: 'x'.repeat(5000)
    })
    const [first, second] = await records()
    assert.equal(first.event, 'peer.connect')
    assert.equal(first.level, 'info')
    assert.equal(first.proc, 'client')
    assert.equal(first.pid, process.pid)
    assert.equal(first.peer, 1)
    assert.match(String(first.ts), /^\d{4}-\d{2}-\d{2}T/)
    const error = second.error as { message: string; code: string; stack: string }
    assert.equal(error.message, 'boom')
    assert.equal(error.code, 'EPIPE')
    assert.ok(error.stack.split('\n').length <= 8)
    assert.equal((second.huge as string).length, 500)
  } finally {
    if (previous === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test('log rotates an oversized file to server.log.1 instead of deleting it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cerebro-log-'))
  const previous = process.env.CEREBRO_HOME
  process.env.CEREBRO_HOME = home
  try {
    log('info', 'warmup')
    await writeFile(logPath(), 'old evidence\n'.repeat(100_000))
    rotateLog()
    log('info', 'after.rotation')
    assert.match(await readFile(`${logPath()}.1`, 'utf8'), /^old evidence/)
    assert.equal((await records()).at(-1)?.event, 'after.rotation')
    assert.ok((await stat(logPath())).size < 1024)
  } finally {
    if (previous === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test('log never throws when the mux directory cannot be written', () => {
  const previous = process.env.CEREBRO_HOME
  process.env.CEREBRO_HOME = '/dev/null/not-a-directory'
  try {
    rotateLog()
    assert.doesNotThrow(() => log('error', 'unwritable'))
  } finally {
    if (previous === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previous
  }
})
