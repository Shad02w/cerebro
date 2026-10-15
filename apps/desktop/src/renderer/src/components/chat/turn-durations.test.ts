import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearTurnDurations,
  elapsedSeconds,
  syncTurnClock,
  useTurnDuration
} from './turn-durations'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('a watched turn is at least one second', () => {
  assert.equal(elapsedSeconds(1_000, 1_200), 1)
  assert.equal(elapsedSeconds(1_000, 4_600), 4)
})

test('settles a busy turn when it stops, and keeps the original start across updates', () => {
  clearTurnDurations()
  syncTurnClock(true, ['turn'], ['turn'], 1_000)
  syncTurnClock(true, ['turn'], ['turn'], 5_000)
  syncTurnClock(false, [], ['turn'], 6_400)
  assert.equal(readDuration('turn'), 5)
  clearTurnDurations()
})

test('an idle view settles only its own turns', () => {
  clearTurnDurations()
  syncTurnClock(true, ['a'], ['a'], 1_000)
  syncTurnClock(true, ['b'], ['b'], 1_000)
  syncTurnClock(false, [], ['a'], 4_000)
  assert.equal(readDuration('a'), 3)
  assert.equal(readDuration('b'), null)
  syncTurnClock(false, [], ['b'], 5_000)
  assert.equal(readDuration('b'), 4)
  clearTurnDurations()
})

function readDuration(turnId: string): number | null {
  let value: number | null = null
  function Probe(): null {
    value = useTurnDuration(turnId)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return value
}
