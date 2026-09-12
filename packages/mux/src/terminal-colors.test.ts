import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Terminal } from '@xterm/headless'
import { TERMINAL_PALETTES } from '@cerebro/core'
import { TerminalColors } from './terminal-colors'
const osc = (value: string): string => `\x1b]${value}\x1b\\`
const write = (term: Terminal, data: string): Promise<void> =>
  new Promise((resolve) => term.write(data, resolve))

test('Codex foreground/background probes receive exact theme colors, once, in order', async () => {
  for (const [theme, palette] of Object.entries(TERMINAL_PALETTES)) {
    const term = new Terminal({ allowProposedApi: true })
    const replies: string[] = []
    new TerminalColors(
      term,
      async () => theme as keyof typeof TERMINAL_PALETTES,
      (data) => replies.push(data)
    )
    term.onData((data) => replies.push(data))
    await write(term, osc('10;?;?;?') + '\x1b[5n')
    const expected = (id: number, hex: string): string =>
      osc(
        `${id};rgb:${hex
          .slice(1)
          .match(/../g)!
          .map((c) => c.repeat(2))
          .join('/')}`
      )
    assert.deepEqual(
      replies,
      [
        expected(10, palette.foreground ?? '#ffffff'),
        expected(11, palette.background ?? '#000000'),
        expected(12, palette.cursor ?? '#ffffff'),
        '\x1b[0n'
      ],
      theme
    )
    term.dispose()
  }
})

test('indexed colors, application overrides, resets and invalid OSC match xterm semantics', async () => {
  const term = new Terminal({ allowProposedApi: true })
  const replies: string[] = []
  new TerminalColors(
    term,
    async () => 'cerebro-default',
    (data) => replies.push(data)
  )
  await write(term, osc('4;1;#123456;16;?;231;?;232;?;255;?;1;?'))
  assert.deepEqual(replies, [
    osc('4;16;rgb:0000/0000/0000'),
    osc('4;231;rgb:ffff/ffff/ffff'),
    osc('4;232;rgb:0808/0808/0808'),
    osc('4;255;rgb:eeee/eeee/eeee'),
    osc('4;1;rgb:1212/3434/5656')
  ])
  replies.length = 0
  await write(
    term,
    osc('10;rgb:12/34/56') +
      osc('10;invalid') +
      osc('10;?') +
      osc('110') +
      osc('10;?') +
      osc('104;1') +
      osc('4;1;?;256;?')
  )
  assert.deepEqual(replies, [
    osc('10;rgb:1212/3434/5656'),
    osc('10;rgb:fafa/fafa/fafa'),
    osc('4;1;rgb:cccc/0000/0000')
  ])
  term.dispose()
})

test('palette survives checkpoints and renderer replay; theme changes restore defaults', async () => {
  let theme: keyof typeof TERMINAL_PALETTES = 'dracula'
  const original = new Terminal({ allowProposedApi: true })
  const colors = new TerminalColors(
    original,
    async () => theme,
    () => {}
  )
  await write(original, osc('4;1;#123456;200;#abcdef') + osc('10;#334455;#112233;#778899'))
  const restored = new Terminal({ allowProposedApi: true })
  const replies: string[] = []
  const restoredColors = new TerminalColors(
    restored,
    async () => theme,
    (data) => replies.push(data),
    JSON.parse(JSON.stringify(colors.save()))
  )
  await write(restored, osc('10;?;?;?') + osc('4;1;?;200;?'))
  const before = [...replies]
  replies.length = 0
  await write(restored, colors.serialize() + osc('10;?;?;?') + osc('4;1;?;200;?'))
  assert.deepEqual(replies, before)
  assert.deepEqual(restoredColors.save(), colors.save())
  theme = 'nord'
  replies.length = 0
  await write(restored, osc('10;?') + osc('4;1;?'))
  assert.deepEqual(replies, [osc('10;rgb:d8d8/dede/e9e9'), osc('4;1;rgb:bfbf/6161/6a6a')])
  original.dispose()
  restored.dispose()
})

test('truecolor cells and animated Braille frames survive serialization', async () => {
  const { SerializeAddon } = await import('@xterm/addon-serialize')
  const term = new Terminal({ allowProposedApi: true })
  const serialized = new SerializeAddon()
  term.loadAddon(serialized)
  const restored = new Terminal({ allowProposedApi: true })
  for (const dot of ['⠁', '⠂', '⠄']) {
    await write(term, `\r\x1b[38;2;128;144;160m\x1b[48;2;32;40;48m${dot}`)
    restored.reset()
    await write(restored, serialized.serialize())
    const cell = restored.buffer.active.getLine(0)!.getCell(0)!
    assert.equal(cell.getChars(), dot)
    assert.equal(cell.getFgColor(), 0x8090a0)
    assert.equal(cell.getBgColor(), 0x202830)
  }
  term.dispose()
  restored.dispose()
})
