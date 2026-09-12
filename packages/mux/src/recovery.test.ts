import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { captureTerminalContinuation, restoreTerminalContinuation } from '@cerebro/core'
import { TerminalFiles } from './storage'
import { VtBoundary } from './vt-boundary'
import { newShellSessionSequence } from './terminal-session'
const write = (term: Terminal, data: string): Promise<void> =>
  new Promise((resolve) => term.write(data, resolve))
function text(term: Terminal): string {
  const b = term.buffer.active
  return Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true)).join(
    '\n'
  )
}
test('screen checkpoint plus continuation matches uninterrupted VT interpretation', async () => {
  const prefixes = [
    'A'.repeat(80),
    '\x1b[4hINSERT\x1b[2;1H\x1b[?25l',
    '\x1b[31mred\x1b[0m\r\n你好 😀\r\n\x1b7saved\x1b[10;5H',
    '\x1b(0lqqk\x1b7\x1b[5;1H',
    '\x1b[3g\x1b[1;5H\x1bH\x1b[1;1H',
    'normal\x1b[?1049h\x1b[2;10Halternate\x1b[3;8r\x1b[?6h'
  ]
  for (const prefix of prefixes) {
    const original = new Terminal({ cols: 80, rows: 24, allowProposedApi: true, scrollback: 10000 })
    const restored = new Terminal({ cols: 80, rows: 24, allowProposedApi: true, scrollback: 10000 })
    const serialize = new SerializeAddon()
    original.loadAddon(serialize)
    await write(original, prefix)
    const continuation = captureTerminalContinuation(original)
    await write(restored, serialize.serialize())
    restoreTerminalContinuation(restored, continuation)
    const suffix = '\x1b8\tX\r\nnext\x1b[0m'
    await write(original, suffix)
    await write(restored, suffix)
    assert.equal(text(restored), text(original), JSON.stringify(prefix))
    assert.equal(restored.buffer.active.cursorX, original.buffer.active.cursorX)
    assert.equal(restored.buffer.active.cursorY, original.buffer.active.cursorY)
    original.dispose()
    restored.dispose()
  }
})
test('snapshots recover after a torn journal and fall back after checkpoint corruption', () => {
  const home = mkdtempSync(join(tmpdir(), 'cerebro-recovery-'))
  const previous = process.env.CEREBRO_HOME
  process.env.CEREBRO_HOME = home
  try {
    const files = new TerminalFiles()
    files.checkpoint({ paneId: 1, sequence: 0, data: 'initial' })
    files.append(1, { sequence: 1, data: 'one' })
    files.checkpoint({ paneId: 1, sequence: 1, data: 'one' })
    files.append(1, { sequence: 2, data: 'two' })
    files.flush()
    const dir = join(home, 'mux/terminals/1')
    appendFileSync(join(dir, '2.journal'), '{torn')
    assert.deepEqual(new TerminalFiles().load(1)?.events, [{ sequence: 2, data: 'two' }])
    writeFileSync(join(dir, '2.snapshot'), 'broken')
    const recovered = new TerminalFiles().load(1)!
    assert.equal(recovered.snapshot.sequence, 0)
    assert.deepEqual(recovered.events, [
      { sequence: 1, data: 'one' },
      { sequence: 2, data: 'two' }
    ])
  } finally {
    if (previous === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})
test('incomplete CSI continuation is preserved across snapshot boundaries', async () => {
  const boundary = new VtBoundary()
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  await write(terminal, boundary.take('before\x1b[31'))
  const restoredBoundary = new VtBoundary()
  restoredBoundary.pending = boundary.pending
  assert.equal(restoredBoundary.take('mRED\x1b[0m'), '\x1b[31mRED\x1b[0m')
  assert.equal(restoredBoundary.take('\x9b31'), '')
  assert.equal(restoredBoundary.take('mC1'), '\x9b31mC1')
  terminal.dispose()
})
test('checkpoint rotation retains only current and previous generations', () => {
  const home = mkdtempSync(join(tmpdir(), 'cerebro-retention-'))
  const previous = process.env.CEREBRO_HOME
  process.env.CEREBRO_HOME = home
  try {
    const files = new TerminalFiles()
    for (let sequence = 0; sequence < 30; sequence++) {
      files.checkpoint({ paneId: 1, sequence, data: 'bounded screen' })
      files.append(1, { sequence: sequence + 1, data: 'output' })
    }
    assert.deepEqual(readdirSync(join(home, 'mux/terminals/1')).sort(), [
      '29.journal',
      '29.snapshot',
      '30.journal',
      '30.snapshot',
      'manifest.json'
    ])
    assert.equal(new TerminalFiles().load(1)?.snapshot.sequence, 29)
  } finally {
    if (previous === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('xterm 6 restores real 5.5 snapshots and preserves subsequent interpretation', async () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/xterm-5.5.json'), 'utf8'))
  for (const entry of fixture.cases) {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    await write(term, entry.snapshot.data)
    restoreTerminalContinuation(term, entry.snapshot.continuation)
    await write(term, entry.suffix)
    assert.equal(text(term), entry.expected.text)
    assert.equal(term.buffer.active.cursorX, entry.expected.x)
    assert.equal(term.buffer.active.cursorY, entry.expected.y)
    assert.equal(captureTerminalContinuation(term).version, 2)
    term.dispose()
  }
})

test('v6 continuation retains cursor overrides but never restores a paused render transaction', async () => {
  const original = new Terminal({ allowProposedApi: true })
  const restored = new Terminal({ allowProposedApi: true })
  await write(original, '\x1b[5 q\x1b[?2026h')
  const state = captureTerminalContinuation(original)
  assert.equal(state.privateModes.cursorStyle, 'bar')
  assert.equal(state.privateModes.cursorBlink, true)
  assert.equal('synchronizedOutput' in state.privateModes, false)
  await write(restored, '\x1b[?2026h')
  restoreTerminalContinuation(restored, JSON.parse(JSON.stringify(state)))
  assert.deepEqual(captureTerminalContinuation(restored).privateModes, state.privateModes)
  const replies: string[] = []
  restored.onData((data) => replies.push(data))
  await write(restored, '\x1b[?2026$p')
  assert.deepEqual(replies, ['\x1b[?2026;2$y'])
  await write(original, '\x1b[?12l\x1b[0 q')
  restoreTerminalContinuation(restored, captureTerminalContinuation(original))
  assert.equal(restored.options.cursorBlink, false)
  assert.equal(captureTerminalContinuation(restored).privateModes.cursorStyle, undefined)
  original.dispose()
  restored.dispose()
})

test('legacy snapshots and journals are backed up before v6 checkpoint rotation', () => {
  const home = mkdtempSync(join(tmpdir(), 'cerebro-v6-migration-'))
  const previous = process.env.CEREBRO_HOME
  process.env.CEREBRO_HOME = home
  try {
    const files = new TerminalFiles()
    files.checkpoint({ paneId: 1, sequence: 0, continuation: { version: 1 }, data: 'old' })
    files.append(1, { sequence: 1, data: 'tail' })
    files.flush()
    const dir = join(home, 'mux/terminals/1')
    const before = readFileSync(join(dir, '1.snapshot'), 'utf8')
    const journal = readFileSync(join(dir, '1.journal'), 'utf8')
    files.load(1)
    for (let sequence = 2; sequence < 6; sequence++) {
      files.checkpoint({ paneId: 1, sequence, continuation: { version: 2 }, data: 'new' })
    }
    assert.equal(readFileSync(join(dir, 'xterm-5.5-backup/1.snapshot'), 'utf8'), before)
    assert.equal(readFileSync(join(dir, 'xterm-5.5-backup/1.journal'), 'utf8'), journal)
    assert.equal(
      JSON.parse(readFileSync(join(dir, 'xterm-5.5-backup/manifest.json'), 'utf8')).current,
      1
    )
  } finally {
    if (previous === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

for (const alternate of [false, true]) {
  test(`new shell marker preserves restored content with cursor at top (alternate=${alternate})`, async () => {
    const term = new Terminal({ cols: 80, rows: 8, allowProposedApi: true })
    try {
      const lines = [
        '╭──────────────────────────────────────────────────────────╮',
        '│ OpenAI Codex (v0.154.0)                                   │',
        '╰──────────────────────────────────────────────────────────╯'
      ]
      await write(term, lines.join('\r\n') + '\x1b[8;1HBOTTOM_CONTENT')
      // Reproduce a saved animation cursor at the top of a populated screen.
      await write(term, '\x1b[H' + (alternate ? '\x1b[?1049hALT' : '') + '\x1b[2;5r\x1b[?6h\x1b[4h')
      await write(term, newShellSessionSequence(term.rows) + '$ ')
      const output = text(term).split('\n')
      for (const line of lines) assert.ok(output.includes(line), text(term))
      const bottom = output.indexOf('BOTTOM_CONTENT')
      const marker = output.indexOf('── New shell session ──')
      assert.ok(bottom >= 0 && marker > bottom, text(term))
      assert.equal(output[marker + 1], '$ ')
      assert.equal(term.buffer.active.type, 'normal')
    } finally {
      term.dispose()
    }
  })
}
