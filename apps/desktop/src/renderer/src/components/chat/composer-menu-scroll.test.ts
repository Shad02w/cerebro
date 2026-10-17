import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scrollOptionIntoView } from './composer-menu-scroll'

const box = (
  top: number,
  bottom: number,
  scrollTop = 0
): { getBoundingClientRect: () => { top: number; bottom: number }; scrollTop: number } => ({
  getBoundingClientRect: () => ({ top, bottom }),
  scrollTop
})

test('scrolls a row below the menu into view by the overflow amount', () => {
  const container = box(0, 100)
  scrollOptionIntoView(container, box(140, 180))
  assert.equal(container.scrollTop, 80)
})

test('scrolls a row above the menu back down by the overflow amount', () => {
  const container = box(40, 140, 40)
  scrollOptionIntoView(container, box(10, 50))
  assert.equal(container.scrollTop, 10)
})

test('leaves the scrollport alone when the row is already fully visible', () => {
  const container = box(0, 100, 12)
  scrollOptionIntoView(container, box(20, 60))
  assert.equal(container.scrollTop, 12)
})
