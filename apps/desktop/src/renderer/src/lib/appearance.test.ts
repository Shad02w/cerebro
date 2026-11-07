import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_APPEARANCE, parseAppearance, resolveColorMode, UI_STYLES } from './appearance'

test('parses a stored style and mode', () => {
  assert.deepEqual(parseAppearance('{"style":"editor","mode":"light"}'), {
    style: 'editor',
    mode: 'light'
  })
})

test('falls back per field for unknown or corrupt values', () => {
  assert.deepEqual(parseAppearance(null), DEFAULT_APPEARANCE)
  assert.deepEqual(parseAppearance('not json'), DEFAULT_APPEARANCE)
  assert.deepEqual(parseAppearance('{"style":"glass","mode":"dark"}'), {
    style: DEFAULT_APPEARANCE.style,
    mode: 'dark'
  })
})

test('system mode follows the OS preference; explicit modes ignore it', () => {
  assert.equal(resolveColorMode('system', true), 'dark')
  assert.equal(resolveColorMode('system', false), 'light')
  assert.equal(resolveColorMode('light', true), 'light')
  assert.equal(resolveColorMode('dark', false), 'dark')
})

test('offers classic plus five redesign styles with unique ids', () => {
  const ids = UI_STYLES.map((style) => style.id)
  assert.deepEqual(ids, ['classic', 'graphite', 'editor', 'paper', 'swiss', 'slate'])
})
