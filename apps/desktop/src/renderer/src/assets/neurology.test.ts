import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('neurology mark is a colorable single-path SVG', () => {
  const svg = readFileSync(join(__dirname, 'neurology.svg'), 'utf8')
  assert.ok(svg.includes('fill="currentColor"'))
  assert.doesNotMatch(svg, /fill="#[0-9A-Fa-f]{3,8}"/)
  const path = svg.match(/\sd="([^"]+)"/)
  assert.ok(path && path[1].length > 20)
})
