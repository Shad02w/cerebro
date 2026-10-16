import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, createConnection, type Socket } from 'node:net'
import { EventEmitter, once } from 'node:events'
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

test('a full socket keeps RPC replies and does not drop the peer for an event', () => {
  const writes: Buffer[] = []
  let destroyed = false
  const socket = new EventEmitter() as EventEmitter & {
    destroyed: boolean
    writableLength: number
    cork: () => void
    uncork: () => void
    write: (chunk: Buffer) => boolean
    destroy: () => void
  }
  socket.destroyed = false
  socket.writableLength = MAX_MESSAGE + 3 * 1024 * 1024
  socket.cork = () => {}
  socket.uncork = () => {}
  socket.write = (chunk: Buffer) => {
    writes.push(Buffer.from(chunk))
    return true
  }
  socket.destroy = () => {
    destroyed = true
    socket.destroyed = true
  }
  const wire = new Wire(socket as unknown as Socket)
  wire.send({ event: 'chat', data: { workspaceId: 1 } })
  assert.equal(destroyed, false)
  assert.equal(writes.length, 0)
  wire.send({ id: 'prompt', result: { ok: true } })
  assert.equal(destroyed, false)
  assert.ok(writes.length >= 2)
  const payload = Buffer.concat(writes.filter((_, index) => index % 2 === 1))
  assert.deepEqual(JSON.parse(payload.toString('utf8')), { id: 'prompt', result: { ok: true } })
})
