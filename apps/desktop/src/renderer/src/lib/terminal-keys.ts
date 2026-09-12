/**
 * xterm.js 5 only encodes Ctrl chords that map to ASCII C0 bytes (Ctrl+A–Z,
 * Ctrl+Space, Ctrl+[ \ ], Ctrl+3–8, Ctrl+@, Ctrl+_). Punctuation like Ctrl+;
 * produces no bytes, so Neovim never sees `<C-;>`.
 *
 * Shift+Enter is also collapsed to plain CR (`\r`), so Claude Code / Codex
 * cannot tell it apart from Enter and always submit.
 *
 * Other xterm.js hosts (Wave, VS Code sendSequence workarounds) fill the gap
 * by sending CSI u (`CSI codepoint ; modifiers u`). Neovim already parses
 * Ctrl+punctuation that way; Claude Code / Codex treat `\x1b[13;2u` as
 * Shift+Enter → insert newline.
 */

const ESC = '\x1b'

/** Physical-key fallback when Chromium reports `key` as Unidentified. */
const CODE_TO_CHAR: Record<string, string> = {
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit9: '9'
}

export type TerminalKeyEvent = {
  type: string
  key: string
  code: string
  keyCode: number
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}

function csiModifier(event: TerminalKeyEvent): number {
  return (
    1 +
    (event.shiftKey ? 1 : 0) +
    (event.altKey ? 2 : 0) +
    (event.ctrlKey ? 4 : 0) +
    (event.metaKey ? 8 : 0)
  )
}

function resolvedChar(event: TerminalKeyEvent): string | null {
  if (event.key.length === 1) return event.key
  return CODE_TO_CHAR[event.code] ?? null
}

function isEnterKey(event: TerminalKeyEvent): boolean {
  return event.key === 'Enter' || event.code === 'Enter' || event.keyCode === 13
}

/**
 * True when xterm.js Keyboard.ts already emits a C0 byte for this chord.
 * Those must stay as C0 so Ctrl+C still interrupts the shell.
 */
function hasLegacyCtrlEncoding(event: TerminalKeyEvent): boolean {
  if (event.altKey || event.metaKey) return false
  if (event.ctrlKey && !event.shiftKey) {
    const { keyCode } = event
    if (keyCode >= 65 && keyCode <= 90) return true
    if (keyCode === 32) return true
    if (keyCode >= 51 && keyCode <= 56) return true
    if (keyCode === 219 || keyCode === 220 || keyCode === 221) return true
  }
  return event.ctrlKey && (event.key === '_' || event.key === '@')
}

/** CSI u for bare Shift+Enter (`\x1b[13;2u`). Leave Ctrl/Alt/Meta to xterm. */
function encodeShiftEnter(event: TerminalKeyEvent): string | null {
  if (!isEnterKey(event)) return null
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null
  return `${ESC}[13;${csiModifier(event)}u`
}

/** CSI u sequence for keys that xterm.js would otherwise drop or collapse. */
export function encodeExtendedKey(event: TerminalKeyEvent): string | null {
  if (event.type !== 'keydown') return null
  if (event.isComposing) return null

  const shiftEnter = encodeShiftEnter(event)
  if (shiftEnter != null) return shiftEnter

  if (!event.ctrlKey || event.altKey || event.metaKey) return null
  if (hasLegacyCtrlEncoding(event)) return null

  const character = resolvedChar(event)
  if (character == null) return null

  const codePoint = character.codePointAt(0)
  if (codePoint == null || codePoint < 32) return null

  return `${ESC}[${codePoint};${csiModifier(event)}u`
}
