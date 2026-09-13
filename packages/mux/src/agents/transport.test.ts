import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { JsonProcess } from './transport'

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
