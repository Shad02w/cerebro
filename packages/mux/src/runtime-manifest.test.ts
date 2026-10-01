import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtimeOutdated } from './runtime-manifest'
test('a newer build replaces an older or unlabeled host; older or equal builds never do', () => {
  const current = { muxHash: 'b', builtAt: 200 }
  assert.equal(runtimeOutdated(current, { muxHash: 'a', builtAt: 100 }), true)
  assert.equal(runtimeOutdated(current, undefined), true)
  assert.equal(runtimeOutdated(current, { muxHash: 'a' }), true)
  assert.equal(runtimeOutdated(current, { muxHash: 'b', builtAt: 100 }), false)
  assert.equal(runtimeOutdated(current, { muxHash: 'c', builtAt: 300 }), false)
  assert.equal(runtimeOutdated(current, { muxHash: 'c', builtAt: 200 }), false)
  assert.equal(runtimeOutdated({ muxHash: 'b' }, { muxHash: 'a', builtAt: 100 }), false)
  assert.equal(runtimeOutdated(undefined, { muxHash: 'a', builtAt: 100 }), false)
})
