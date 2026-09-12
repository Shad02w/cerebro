import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TerminalOutput } from './terminal-output'
const start = '\x1b[?2026h'
const end = '\x1b[?2026l'

test('split decoration frames are delivered together with the restored input cursor', () => {
  const writes: string[] = []
  let acknowledgments = 0
  const output = new TerminalOutput((data, done) => {
    writes.push(data)
    done()
  })
  output.push(`${start}\x1b[17;55H⠁`, () => acknowledgments++)
  assert.deepEqual(writes, [])
  assert.equal(acknowledgments, 0)
  output.push(`\x1b[16;5H\x1b[?25h${end}`, () => acknowledgments++)
  assert.deepEqual(writes, [`${start}\x1b[17;55H⠁\x1b[16;5H\x1b[?25h${end}`])
  assert.equal(acknowledgments, 2)
  output.dispose()
})
test('ordinary output is immediate; markers split across writes remain recognized', () => {
  const writes: string[] = []
  const output = new TerminalOutput((data, done) => {
    writes.push(data)
    done()
  })
  output.push('shell output', () => {})
  output.push('\x1b[?20', () => {})
  output.push('26hFRAME', () => {})
  assert.equal(writes.length, 2)
  output.push(end, () => {})
  assert.equal(writes.join(''), `shell output${start}FRAME${end}`)
  output.dispose()
})
test('frame-like text inside OSC and DCS is not interpreted as a frame marker', () => {
  const writes: string[] = []
  const output = new TerminalOutput((data, done) => {
    writes.push(data)
    done()
  })
  for (const prefix of ['\x1b]0;', '\x1bP']) {
    const data = `${prefix}${start}title\x1b\\plain`
    output.push(data, () => {})
    assert.equal(writes.at(-1), data)
  }
  output.dispose()
})
test('missing end markers cannot indefinitely stall output or grow the buffer', async () => {
  const writes: string[] = []
  const output = new TerminalOutput(
    (data, done) => {
      writes.push(data)
      done()
    },
    10,
    100
  )
  output.push(start + 'partial', () => {})
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(writes.length, 1)
  output.push(start + 'x'.repeat(100), () => {})
  assert.equal(writes.length, 2)
  output.push('normal', () => {})
  assert.equal(writes.at(-1), 'normal')
  output.dispose()
})
test('disposing a view cancels pending writes and acknowledgments', async () => {
  let written = false
  const output = new TerminalOutput(() => {
    written = true
  }, 10)
  output.push(start, () => {
    written = true
  })
  output.dispose()
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(written, false)
})
