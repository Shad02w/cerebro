import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatSessionAge, sessionCreatedLabel } from './session-age'

const now = 1_700_000_000_000

test('session age is compact and counts from creation', () => {
  assert.equal(formatSessionAge(now - 30_000, now), '<1m')
  assert.equal(formatSessionAge(now, now), '<1m')
  assert.equal(formatSessionAge(now + 5_000, now), '<1m')
  assert.equal(formatSessionAge(now - 60_000, now), '1m')
  assert.equal(formatSessionAge(now - 90_000, now), '1m')
  assert.equal(formatSessionAge(now - 59 * 60_000, now), '59m')
  assert.equal(formatSessionAge(now - 60 * 60_000, now), '1hr')
  assert.equal(formatSessionAge(now - 17 * 60 * 60_000, now), '17hr')
  assert.equal(formatSessionAge(now - (23 * 60 + 59) * 60_000, now), '23hr')
  assert.equal(formatSessionAge(now - 24 * 60 * 60_000, now), '1d')
  assert.equal(formatSessionAge(now - 3 * 24 * 60 * 60_000, now), '3d')
  assert.equal(formatSessionAge(Number.NaN, now), '')
})

test('session age tooltip spells the same boundary', () => {
  assert.equal(sessionCreatedLabel(now - 20_000, now), 'Created less than a minute ago')
  assert.equal(sessionCreatedLabel(now - 60_000, now), 'Created 1 minute ago')
  assert.equal(sessionCreatedLabel(now - 17 * 60_000, now), 'Created 17 minutes ago')
  assert.equal(sessionCreatedLabel(now - 60 * 60_000, now), 'Created 1 hour ago')
  assert.equal(sessionCreatedLabel(now - 17 * 60 * 60_000, now), 'Created 17 hours ago')
  assert.equal(sessionCreatedLabel(now - 24 * 60 * 60_000, now), 'Created 1 day ago')
  assert.equal(sessionCreatedLabel(now - 2 * 24 * 60 * 60_000, now), 'Created 2 days ago')
})
