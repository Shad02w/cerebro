import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { chatImageMaxBytes, readChatImage, resolveChatImagePath } from './chat-image'

test('resolves absolute, file URL, encoded and home paths', () => {
  assert.equal(resolveChatImagePath('/tmp/a.png'), '/tmp/a.png')
  assert.equal(resolveChatImagePath('file:///tmp/a%20b.png'), '/tmp/a b.png')
  assert.equal(resolveChatImagePath('/tmp/a%20b.png'), '/tmp/a b.png')
  assert.equal(resolveChatImagePath('~/shot.png'), join(homedir(), 'shot.png'))
})

test('rejects remote and relative sources', () => {
  assert.throws(() => resolveChatImagePath('https://example.com/a.png'), /local/)
  assert.throws(() => resolveChatImagePath('http://example.com/a.png'), /local/)
  assert.throws(() => resolveChatImagePath('ftp://example.com/a.png'), /local/)
  assert.throws(() => resolveChatImagePath('docs/a.png'), /absolute/)
})

test('reads supported images and rejects everything else', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cerebro-chat-image-'))
  try {
    const png = join(dir, 'a.PNG')
    await writeFile(png, Buffer.from('png-bytes'))
    assert.deepEqual(await readChatImage(png), {
      mimeType: 'image/png',
      data: Buffer.from('png-bytes').toString('base64')
    })
    const text = join(dir, 'secret.txt')
    await writeFile(text, 'not an image')
    await assert.rejects(readChatImage(text), /Unsupported/)
    await assert.rejects(readChatImage(join(dir, 'missing.png')))
    await assert.rejects(readChatImage(dir + '/'), /Unsupported/)
    const large = join(dir, 'large.webp')
    await writeFile(large, Buffer.alloc(chatImageMaxBytes + 1))
    await assert.rejects(readChatImage(large), /too large/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
