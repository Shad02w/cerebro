import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TERMINAL_FONT_FAMILY_AUTO } from '@shared/types'
import {
  BUNDLED_TERMINAL_FONT,
  isNerdTerminalFamily,
  terminalFontCandidates,
  terminalFontCss,
  terminalFontOptions,
  terminalLetterSpacing,
  widthsAreMonospace
} from './terminal-font'

test('monospace is equal advance for wide and narrow samples', () => {
  assert.equal(widthsAreMonospace(80, 80), true)
  assert.equal(widthsAreMonospace(120, 80), false)
  assert.equal(widthsAreMonospace(0, 0), false)
})

test('auto tries installed nerd fonts by name, then the bundled face', () => {
  assert.deepEqual(terminalFontCandidates(TERMINAL_FONT_FAMILY_AUTO, []), [])
  assert.deepEqual(
    terminalFontCandidates(TERMINAL_FONT_FAMILY_AUTO, ['Menlo', 'JetBrains Mono', 'Cascadia Mono']),
    []
  )
  assert.deepEqual(
    terminalFontCandidates(TERMINAL_FONT_FAMILY_AUTO, [
      'JetBrains Mono',
      'Hack Nerd Font Mono',
      'FiraCode Nerd Font Mono',
      'Hack Nerd Font Mono'
    ]),
    ['FiraCode Nerd Font Mono', 'Hack Nerd Font Mono']
  )
  assert.equal(isNerdTerminalFamily('MesloLGS NF'), true)
  assert.equal(isNerdTerminalFamily('JetBrains Mono'), false)
})

test('an explicit family is tried first, then nerd fonts if it is missing', () => {
  assert.deepEqual(terminalFontCandidates('Menlo', ['Menlo']), ['Menlo'])
  assert.deepEqual(terminalFontCandidates('FiraCode Nerd Font Mono', ['MesloLGS NF']), [
    'FiraCode Nerd Font Mono',
    'MesloLGS NF'
  ])
  assert.deepEqual(terminalFontCandidates('MesloLGS NF', ['MesloLGS NF', 'Hack Nerd Font']), [
    'MesloLGS NF',
    'Hack Nerd Font'
  ])
})

test('the font menu lists only the families it was given', () => {
  assert.deepEqual(
    terminalFontOptions([
      'Liberation Mono',
      'JetBrains Mono',
      'JetBrains Mono',
      BUNDLED_TERMINAL_FONT
    ]).map((option) => option.value),
    [TERMINAL_FONT_FAMILY_AUTO, BUNDLED_TERMINAL_FONT, 'JetBrains Mono', 'Liberation Mono']
  )
  assert.deepEqual(
    terminalFontOptions([]).map((option) => option.label),
    ['Auto', BUNDLED_TERMINAL_FONT]
  )
})

test('letter spacing restores the device pixel WebGL floors away', () => {
  // MesloLGS at 13px is 1233/2048 em. At dpr 2 that is 15.653 device px,
  // which WebGL floors to 15 and clips.
  assert.equal(terminalLetterSpacing(7.82666015625, 2), 1)
  assert.equal(terminalLetterSpacing(7.82666015625, 1), 1)
  assert.equal(terminalLetterSpacing(8, 2), 0)
  assert.equal(terminalLetterSpacing(7.1, 2), 0)
  assert.equal(terminalLetterSpacing(0, 2), 0)
  assert.equal(terminalLetterSpacing(8, 0), 0)
})

test('the bundled face is the glyph fallback after any other family', () => {
  assert.equal(terminalFontCss(BUNDLED_TERMINAL_FONT), '"Cerebro Mono"')
  assert.equal(terminalFontCss('Menlo'), '"Menlo", "Cerebro Mono"')
  assert.equal(
    terminalFontCss('JetBrainsMono Nerd Font Mono'),
    '"JetBrainsMono Nerd Font Mono", "Cerebro Mono"'
  )
})
