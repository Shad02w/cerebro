import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, createConnection } from 'node:net'
import { once } from 'node:events'
import { Wire, MAX_MESSAGE } from './protocol'

test('fragmented frames restore large Unicode snapshots and adjacent messages', async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const accepted = once(server, 'connection')
  const socket = createConnection(address.port, '127.0.0.1')
  const [peer] = await accepted
  const receiver = new Wire(peer),
    sender = new Wire(socket)
  try {
    const large = '你好😀'.repeat(120000)
    const first = once(receiver, 'message')
    sender.send({ id: 'snapshot', result: large })
    assert.deepEqual((await first)[0], { id: 'snapshot', result: large })
    const second = once(receiver, 'message')
    sender.send({ id: 'small', result: 42 })
    assert.equal((await second)[0].result, 42)
    const closed = once(receiver, 'close')
    const header = Buffer.alloc(4)
    header.writeUInt32BE(MAX_MESSAGE)
    socket.write(header)
    await closed
  } finally {
    socket.destroy()
    peer.destroy()
    server.close()
  }
})
