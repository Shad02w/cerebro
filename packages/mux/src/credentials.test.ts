import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideHandshake, type InstallationState } from './credentials'

const intact = (token: string | null): InstallationState => ({ token, database: true })

test('a handshake accepts only the current token file', () => {
  assert.equal(decideHandshake('secret', intact('secret')), 'accept')
  assert.equal(decideHandshake('other', intact('secret')), 'reject')
  assert.equal(decideHandshake(undefined, intact('secret')), 'reject')
  assert.equal(decideHandshake('secret', intact(null)), 'reject')
})

test('a missing database resets the daemon even when the token matches', () => {
  assert.equal(decideHandshake('secret', { token: 'secret', database: false }), 'reset')
  assert.equal(decideHandshake('other', { token: null, database: false }), 'reset')
})
