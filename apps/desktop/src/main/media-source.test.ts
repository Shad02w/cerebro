import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mediaSourceFromUrl, mediaUrl } from '../shared/media'
import { parseByteRange, resolveMediaFile } from './media-source'

test('accepts local video and image files with supported extensions', () => {
  assert.deepEqual(resolveMediaFile('/tmp/clip.mp4'), {
    path: '/tmp/clip.mp4',
    contentType: 'video/mp4'
  })
  assert.equal(resolveMediaFile('file:///tmp/clip%20one.webm').contentType, 'video/webm')
  assert.equal(resolveMediaFile('/tmp/clip.mp4#t=2').path, '/tmp/clip.mp4')
  assert.equal(resolveMediaFile('/tmp/poster.PNG').contentType, 'image/png')
  assert.throws(() => resolveMediaFile('https://example.com/clip.mp4'), /local/)
  assert.throws(() => resolveMediaFile('/tmp/notes.txt'), /Unsupported/)
  assert.throws(() => resolveMediaFile('clip.mp4'), /absolute/)
})

test('round-trips a local source through a media URL', () => {
  const source = 'file:///tmp/clip%20one.mp4'
  assert.equal(mediaSourceFromUrl(mediaUrl(source)), source)
  assert.equal(mediaSourceFromUrl('cerebro-media://elsewhere/x.mp4'), null)
  assert.equal(mediaSourceFromUrl('https://example.com/clip.mp4'), null)
})

test('parses byte ranges for video seeking', () => {
  assert.equal(parseByteRange(null, 100), null)
  assert.deepEqual(parseByteRange('bytes=0-', 100), { start: 0, end: 99 })
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 })
  assert.deepEqual(parseByteRange('bytes=90-400', 100), { start: 90, end: 99 })
  assert.deepEqual(parseByteRange('bytes=-20', 100), { start: 80, end: 99 })
  assert.deepEqual(parseByteRange('bytes=-500', 100), { start: 0, end: 99 })
  assert.equal(parseByteRange('bytes=100-', 100), 'invalid')
  assert.equal(parseByteRange('bytes=20-10', 100), 'invalid')
  assert.equal(parseByteRange('bytes=0-', 0), 'invalid')
  assert.equal(parseByteRange('items=0-1', 100), 'invalid')
  assert.equal(parseByteRange('bytes=0-1,4-5', 100), 'invalid')
})
