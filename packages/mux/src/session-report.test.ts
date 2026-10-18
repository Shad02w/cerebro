import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import type { AgentSession } from '@cerebro/core'
import { collectSessionReport, exportSessionReport } from './session-report'

function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, 'end of central directory')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, Buffer>()
  for (let index = 0; index < count; index++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50)
    const method = zip.readUInt16LE(at + 10)
    const checksum = zip.readUInt32LE(at + 16)
    const packed = zip.readUInt32LE(at + 20)
    const raw = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const extra = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const body = zip.subarray(start, start + packed)
    const data = method === 8 ? inflateRawSync(body) : body
    assert.equal(data.length, raw)
    assert.equal(crc32(data), checksum, `crc of ${name}`)
    files.set(name, data)
    at += 46 + nameLength + extra
  }
  return files
}

const png = Buffer.from('session-image-bytes')

function session(): AgentSession {
  return {
    version: 1,
    id: 'sess-1',
    workspaceId: 4,
    repositoryId: 9,
    cwd: join(homedir(), 'secret-app'),
    title: 'Login failed ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    model: {
      key: 'claude:anthropic:sonnet',
      instance: 'local',
      harness: 'claude',
      provider: 'anthropic',
      id: 'claude-sonnet',
      label: 'Sonnet',
      source: 'native',
      available: true,
      reasoning: ['low']
    },
    reasoning: 'low',
    accessMode: 'edit',
    status: 'failed',
    generation: 'g1',
    turnId: 'turn-1',
    sequence: 3,
    updatedAt: 10,
    error: 'Authorization: Bearer abcdefghijklmnop1234',
    items: [
      {
        id: 'user-1',
        turnId: 'turn-1',
        kind: 'user',
        text: `Inspect ${join(homedir(), 'secret-app', 'token')}`,
        attachments: [
          {
            id: 'shot',
            kind: 'image',
            name: 'board.png',
            mimeType: 'image/png',
            bytes: png.length
          }
        ]
      },
      {
        id: 'reply-1',
        turnId: 'turn-1',
        kind: 'text',
        text: 'The token is ghp_abcdefghijklmnopqrstuvwxyz0123456789'
      }
    ],
    commands: [`cat ${join(homedir(), 'secret-app', 'token')}`],
    contextUsage: { usedTokens: 12, contextWindow: 100, percentage: 12 }
  }
}

test('a session report keeps that conversation and leaves message text out', () => {
  const { report, entries } = collectSessionReport({
    session: session(),
    score: 'problem',
    comment: 'It stopped after the screenshot'
  })
  assert.equal(report.scope, 'session')
  assert.equal(report.score, 'problem')
  assert.equal(report.includeTranscript, false)
  assert.equal(report.session.id, 'sess-1')
  assert.equal(report.session.workspaceId, 4)
  const model = report.session.model as { harness: string; label: string }
  assert.equal(model.harness, 'claude')
  assert.equal(model.label, 'Sonnet')
  assert.equal(report.session.status, 'failed')
  assert.match(String(report.session.error), /\[redacted\]/)
  assert.equal(report.session.title, undefined)
  assert.equal(report.session.commands, undefined)
  const items = report.session.items as Array<Record<string, unknown>>
  assert.equal(items.length, 2)
  assert.equal(items[0]?.text, undefined)
  assert.equal(items[1]?.text, undefined)
  assert.deepEqual(items[0]?.attachments, [
    { id: 'shot', mimeType: 'image/png', bytes: png.length, name: 'board.png' }
  ])
  assert.equal(
    entries.some((entry) => entry.name === 'images/01-shot.png'),
    false
  )
  const json = entries.find((entry) => entry.name === 'report.json')
  assert.ok(json)
  assert.equal(String(json.data).includes('Inspect '), false)
  assert.equal(String(json.data).includes('ghp_'), false)
})

test('opt-in transcript text is redacted, and images are files in the zip', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-session-report-'))
  const previous = process.env.CEREBRO_HOME
  process.env.CEREBRO_HOME = directory
  try {
    const result = await exportSessionReport({
      outputPath: directory,
      input: {
        session: session(),
        score: 'helpful',
        comment: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
        includeTranscript: true,
        images: [
          {
            id: 'shot',
            name: '/Users/me/secret-app/board.png',
            mimeType: 'image/png',
            data: png.toString('base64'),
            source: 'session'
          },
          {
            id: 'extra',
            name: 'note.webp',
            mimeType: 'image/webp',
            data: Buffer.from('second-image').toString('base64'),
            source: 'attached'
          }
        ]
      }
    })
    const files = readZip(await readFile(result.path))
    const report = JSON.parse(files.get('report.json')!.toString('utf8')) as {
      includeTranscript: boolean
      comment: string
      session: { title?: string; items: Array<{ text?: string }>; commands?: string[] }
      images: Array<{ file: string; source: string; data?: string }>
    }
    assert.equal(report.includeTranscript, true)
    assert.match(report.comment, /\[redacted-token\]/)
    assert.equal(report.comment.includes('ghp_'), false)
    assert.match(report.session.title ?? '', /\[redacted-token\]/)
    assert.match(report.session.items[0]?.text ?? '', /~/)
    assert.equal(report.session.items[1]?.text?.includes('ghp_'), false)
    assert.equal(report.images[0]?.source, 'session')
    assert.equal(report.images[1]?.source, 'attached')
    assert.equal(report.images[0]?.data, undefined)
    assert.equal(files.get('images/01-shot.png')?.equals(png), true)
    assert.equal(files.get('images/02-extra.webp')?.equals(Buffer.from('second-image')), true)
    assert.equal(files.get('report.json')!.includes(png.toString('base64')), false)
  } finally {
    if (previous === undefined) delete process.env.CEREBRO_HOME
    else process.env.CEREBRO_HOME = previous
    await rm(directory, { recursive: true, force: true })
  }
})

test('images that are too large or the wrong type are refused', () => {
  const input = {
    session: session(),
    score: 'problem' as const,
    images: [
      {
        id: 'big',
        name: 'big.png',
        mimeType: 'image/png' as const,
        data: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
        source: 'attached' as const
      }
    ]
  }
  assert.throws(() => collectSessionReport(input), /too large/)
  assert.throws(
    () =>
      collectSessionReport({
        ...input,
        images: [
          {
            ...input.images[0],
            id: 'ok',
            data: png.toString('base64'),
            mimeType: 'image/svg+xml' as 'image/png'
          }
        ]
      }),
    /PNG, JPEG, GIF, and WebP/
  )
})
