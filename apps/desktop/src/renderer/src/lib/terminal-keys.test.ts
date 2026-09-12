import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeExtendedKey, type TerminalKeyEvent } from './terminal-keys'

function key(
  partial: Partial<TerminalKeyEvent> & Pick<TerminalKeyEvent, 'key' | 'code'>
): TerminalKeyEvent {
  return {
    type: 'keydown',
    keyCode: 0,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...partial
  }
}

test('Shift+Enter encodes as CSI u so TUI agents can insert a newline', () => {
  assert.equal(
    encodeExtendedKey(
      key({
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        shiftKey: true
      })
    ),
    '\x1b[13;2u'
  )
})

test('plain Enter stays with xterm so shells still receive CR', () => {
  assert.equal(
    encodeExtendedKey(
      key({
        key: 'Enter',
        code: 'Enter',
        keyCode: 13
      })
    ),
    null
  )
})

test('Ctrl+Enter and Alt+Enter are left to xterm defaults', () => {
  assert.equal(
    encodeExtendedKey(
      key({
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        ctrlKey: true
      })
    ),
    null
  )
  assert.equal(
    encodeExtendedKey(
      key({
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        altKey: true
      })
    ),
    null
  )
  assert.equal(
    encodeExtendedKey(
      key({
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        shiftKey: true,
        metaKey: true
      })
    ),
    null
  )
})

test('Ctrl+; still encodes as CSI u for Neovim', () => {
  assert.equal(
    encodeExtendedKey(
      key({
        key: ';',
        code: 'Semicolon',
        keyCode: 186,
        ctrlKey: true
      })
    ),
    '\x1b[59;5u'
  )
})

test('Ctrl+C keeps the legacy C0 path', () => {
  assert.equal(
    encodeExtendedKey(
      key({
        key: 'c',
        code: 'KeyC',
        keyCode: 67,
        ctrlKey: true
      })
    ),
    null
  )
})
