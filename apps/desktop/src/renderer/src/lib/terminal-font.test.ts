import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TERMINAL_FONT_FAMILY_AUTO } from '@shared/types'
import {
  BUNDLED_TERMINAL_FONT,
  chooseTerminalFont,
  fontProbeShowsFace,
  terminalFontCss
} from './terminal-font'

test('a face is installed only when both generic stacks resolve to it', () => {
  assert.equal(fontProbeShowsFace({ monoStack: 100, sansStack: 100, mono: 100, sans: 80 }), true)
  assert.equal(fontProbeShowsFace({ monoStack: 90, sansStack: 80, mono: 90, sans: 80 }), false)
  assert.equal(fontProbeShowsFace({ monoStack: 90, sansStack: 90, mono: 90, sans: 90 }), false)
})

test('auto skips missing names and keeps the bundled monospace', () => {
  assert.equal(chooseTerminalFont(TERMINAL_FONT_FAMILY_AUTO, new Set()), BUNDLED_TERMINAL_FONT)
  assert.equal(
    chooseTerminalFont(TERMINAL_FONT_FAMILY_AUTO, new Set(['Menlo', 'SF Mono'])),
    BUNDLED_TERMINAL_FONT
  )
  assert.equal(
    chooseTerminalFont(
      TERMINAL_FONT_FAMILY_AUTO,
      new Set(['Hack Nerd Font Mono', 'FiraCode Nerd Font Mono', 'Menlo'])
    ),
    'FiraCode Nerd Font Mono'
  )
})

test('an explicit family is used only when that face is installed', () => {
  const available = new Set(['Menlo', BUNDLED_TERMINAL_FONT])
  assert.equal(chooseTerminalFont('Menlo', available), 'Menlo')
  assert.equal(chooseTerminalFont(BUNDLED_TERMINAL_FONT, available), BUNDLED_TERMINAL_FONT)
  assert.equal(chooseTerminalFont('FiraCode Nerd Font Mono', available), BUNDLED_TERMINAL_FONT)
  assert.equal(
    chooseTerminalFont('FiraCode Nerd Font Mono', new Set(['MesloLGS NF'])),
    'MesloLGS NF'
  )
})

test('the bundled face is the glyph fallback after any other family', () => {
  assert.equal(terminalFontCss(BUNDLED_TERMINAL_FONT), '"Cerebro Mono"')
  assert.equal(terminalFontCss('Menlo'), '"Menlo", "Cerebro Mono"')
  assert.equal(
    terminalFontCss('JetBrainsMono Nerd Font Mono'),
    '"JetBrainsMono Nerd Font Mono", "Cerebro Mono"'
  )
})
