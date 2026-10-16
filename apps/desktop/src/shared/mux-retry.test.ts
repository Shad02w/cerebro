import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRecoverableMuxDisconnect, retriesAfterMuxDisconnect } from './mux-retry'

test('chat reads and sends are retried after a mux disconnect', () => {
  assert.equal(retriesAfterMuxDisconnect('chat.command', { action: 'get' }), true)
  assert.equal(retriesAfterMuxDisconnect('chat.command', { action: 'send' }), true)
  assert.equal(retriesAfterMuxDisconnect('chat.command', { action: 'rewind' }), false)
  assert.equal(retriesAfterMuxDisconnect('chat.command', { action: 'fork' }), false)
  assert.equal(retriesAfterMuxDisconnect('chat.command', { action: 'undo' }), false)
  assert.equal(retriesAfterMuxDisconnect('chat.command'), false)
  assert.equal(retriesAfterMuxDisconnect('chat.overview'), true)
  assert.equal(retriesAfterMuxDisconnect('layout.get'), true)
  assert.equal(retriesAfterMuxDisconnect('terminal.write'), false)
  assert.equal(retriesAfterMuxDisconnect('layout.command'), false)
  assert.equal(retriesAfterMuxDisconnect('registry'), false)
})

test('only a dropped in-flight call is treated as recoverable', () => {
  const dropped = Object.assign(new Error('Mux disconnected; operation may have completed.'), {
    code: 'unavailable'
  })
  assert.equal(isRecoverableMuxDisconnect(dropped), true)
  assert.equal(
    isRecoverableMuxDisconnect(
      new Error(
        "Error invoking remote method 'cerebro:chat:command': Error: Mux disconnected; operation may have completed."
      )
    ),
    true
  )
  assert.equal(isRecoverableMuxDisconnect(new Error('Mux is disconnected.')), true)
  assert.equal(
    isRecoverableMuxDisconnect(
      new Error('Mux chat.command timed out; do not blindly repeat mutations.')
    ),
    false
  )
  assert.equal(isRecoverableMuxDisconnect(new Error('Write a message first.')), false)
  assert.equal(isRecoverableMuxDisconnect('Mux disconnected'), false)
})
