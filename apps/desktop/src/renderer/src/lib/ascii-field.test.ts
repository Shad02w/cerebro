import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASCII_LOOKS,
  AsciiFieldFrame,
  Touches,
  createWind,
  heartRadius,
  layoutField,
  noise3,
  type TouchSample
} from './ascii-field'

const blank = (): TouchSample => ({
  pushX: 0,
  pushY: 0,
  raise: 0,
  roused: 0,
  glow: 0,
  afterglow: 0,
  warmth: 0
})

test('layout snaps cells to device pixels and refuses panes too small to texture', () => {
  const layout = layoutField(800, 600, 2)
  assert.ok(layout)
  assert.equal(layout.cellWidthPx, 13)
  assert.equal(layout.cellHeightPx, 26)
  assert.equal(layout.columns, Math.floor(1600 / 13))
  assert.equal(layout.rows, Math.floor(1200 / 26))
  assert.equal(layoutField(100, 600, 2), null)
  assert.equal(layoutField(800, 0, 2), null)
})

test('noise stays within -1..1 and the same seed blows the same wind', () => {
  for (let i = 0; i < 2000; i++) {
    const value = noise3(i * 0.37, i * 0.11, i * 0.07, 9)
    assert.ok(value >= -1 && value <= 1)
  }
  assert.deepEqual(createWind(42), createWind(42))
  const wind = createWind(42, 'figured')
  assert.equal(wind.look, 'figured')
  assert.ok(Math.abs(Math.sin(wind.heading)) < Math.sin(Math.PI / 4))
})

test('a click sends a front outward that has passed a point and faded within its life', () => {
  const touches = new Touches()
  touches.tap(0, 0, 0)
  const early = touches.sample(300, 0, 0.1, blank())
  const arriving = touches.sample(300, 0, 0.9, blank())
  assert.ok(arriving.roused > early.roused * 4)
  assert.ok(arriving.pushX > 0, 'air is shoved away from the click')
  assert.ok(arriving.glow > 0.1)
  touches.prune(4)
  assert.equal(touches.busy(4), false)
})

test('every third click is a heart: lobes up on either side, a point below', () => {
  assert.ok(Math.abs(heartRadius(0, 1) - 1) < 0.02)
  assert.ok(heartRadius(-1, -1) > 1.1 && heartRadius(1, -1) > 1.1)
  assert.ok(Math.abs(heartRadius(-1, -1) - heartRadius(1, -1)) < 0.02)
  assert.ok(heartRadius(1, 1) < heartRadius(1, -1))
  const touches = new Touches()
  touches.tap(0, 0, 0)
  touches.tap(0, 0, 0)
  touches.prune(10)
  touches.tap(0, 0, 10)
  const sideways = touches.sample(200, 0, 10.5, blank()).roused
  const circle = new Touches()
  circle.tap(0, 0, 10)
  assert.notEqual(sideways, circle.sample(200, 0, 10.5, blank()).roused)
})

test('only a quick mouse leaves a warm trail', () => {
  const slow = new Touches()
  for (let i = 0; i < 20; i++) slow.move(i * 2, 0, i * 0.05)
  assert.equal(slow.active(), false)
  const quick = new Touches()
  for (let i = 0; i < 10; i++) quick.move(i * 40, 0, i * 0.02)
  assert.equal(quick.active(), true)
  assert.ok(quick.sample(200, 0, 0.3, blank()).warmth > 0.05)
})

test('a frame lights some of the pane, quieter behind the content, and cycles glyphs', () => {
  const layout = layoutField(900, 700, 1)
  assert.ok(layout)
  const frame = new AsciiFieldFrame(layout, createWind(7, 'mixed'))
  const touches = new Touches()
  const lit = frame.render(10, 0, touches, 1)
  const cells = frame.columns * frame.rows
  assert.ok(lit > cells * 0.05 && lit < cells * 0.9, `lit ${lit} of ${cells}`)
  assert.ok(Array.from(frame.glyph).every((glyph) => glyph < ASCII_LOOKS.mixed.length))

  const before = Array.from(frame.glyph)
  frame.render(14, 0, touches, 1)
  assert.ok(Array.from(frame.glyph).some((glyph, index) => glyph !== before[index]))

  assert.equal(frame.render(10, 0, touches, 0), 0, 'nothing shows before the reveal')
})

test('a click lights and tints the ring even before the wind is revealed', () => {
  const layout = layoutField(900, 700, 1)
  assert.ok(layout)
  const frame = new AsciiFieldFrame(layout, createWind(7))
  const touches = new Touches()
  touches.tap(450, 350, 0)
  frame.render(10, 0.6, touches, 0)
  const tinted = Array.from(frame.tint).filter(
    (tint, index) => tint > 0.3 && (frame.light[index] ?? 0) > 0.05
  ).length
  assert.ok(tinted > 50, `tinted ${tinted}`)
})
