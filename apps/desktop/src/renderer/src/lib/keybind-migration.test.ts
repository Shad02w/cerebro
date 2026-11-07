import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  migrateKeybindOverrides,
  normalizeKeybindOverrides,
  resolveKeybinds
} from '../../../shared/keybinds'

test('a saved Search sessions binding carries over to Open command palette', () => {
  assert.equal(resolveKeybinds({ searchSessions: 'Mod+P' }).openCommandPalette, 'Mod+P')
  assert.deepEqual(migrateKeybindOverrides({ searchSessions: 'Mod+P', newChat: 'Mod+J' }), {
    openCommandPalette: 'Mod+P',
    newChat: 'Mod+J'
  })
  assert.deepEqual(normalizeKeybindOverrides({ searchSessions: 'Mod+P' }), {
    openCommandPalette: 'Mod+P'
  })
})

test('the current id wins over the legacy id', () => {
  assert.deepEqual(
    migrateKeybindOverrides({ searchSessions: 'Mod+P', openCommandPalette: 'Mod+Shift+K' }),
    { openCommandPalette: 'Mod+Shift+K' }
  )
})

test('the default stays Mod+K and untouched overrides keep their identity', () => {
  assert.equal(resolveKeybinds(null).openCommandPalette, 'Mod+K')
  const overrides = { newChat: 'Mod+J' }
  assert.equal(migrateKeybindOverrides(overrides), overrides)
})
