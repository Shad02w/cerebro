import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { JsonProcess, routingEnv } from './transport'

test('closing a native transport actually reaps its child process', { timeout: 5000 }, async () => {
  const rpc = new JsonProcess(
    resolve(__dirname, 'fixtures/fake-harness.cjs'),
    ['app-server'],
    '/tmp'
  )
  await rpc.request('initialize')
  const closed = once(rpc.child, 'close')
  rpc.close()
  const [code, signal] = await closed
  assert(code !== null || signal !== null)
  await assert.rejects(rpc.request('model/list'), /closed/)
})

test('routing env reaches the harness child', async () => {
  assert.deepEqual(routingEnv({ workspaceId: 4, paneId: 9, sessionId: 'sess-1' }), {
    CEREBRO_WORKSPACE_ID: '4',
    CEREBRO_PANE_ID: '9',
    CEREBRO_SESSION_ID: 'sess-1'
  })
  const dir = mkdtempSync(join(tmpdir(), 'cerebro-routing-'))
  const script = join(dir, 'echo-env.cjs')
  writeFileSync(
    script,
    `const { createInterface } = require('node:readline')
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const msg = JSON.parse(line)
  process.stdout.write(JSON.stringify({
    id: msg.id,
    result: {
      workspace: process.env.CEREBRO_WORKSPACE_ID,
      pane: process.env.CEREBRO_PANE_ID,
      session: process.env.CEREBRO_SESSION_ID
    }
  }) + '\\n')
})
`
  )
  const rpc = new JsonProcess(process.execPath, [script], dir, false, {
    workspaceId: 4,
    paneId: 9,
    sessionId: 'sess-1'
  })
  try {
    const result = await rpc.request('echo')
    assert.deepEqual(result, { workspace: '4', pane: '9', session: 'sess-1' })
  } finally {
    rpc.close()
  }
})
