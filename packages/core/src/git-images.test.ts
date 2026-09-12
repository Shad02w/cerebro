import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { listChangedFiles, readChangedFileDiff } from './git'

const execFileAsync = promisify(execFile)

test('reads added, untracked, modified, deleted, and renamed image versions against HEAD', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-image-diff-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args: string[]): Promise<unknown> => execFileAsync('git', args, { cwd: root })
  await git('init')
  await git('config', 'user.email', 'test@cerebro.local')
  await git('config', 'user.name', 'Cerebro Test')
  const before = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>'
  const after = before.replace('red', 'blue')
  for (const path of ['modified.svg', 'deleted.svg', 'old.svg']) {
    await writeFile(join(root, path), before)
  }
  await git('add', '.')
  await git('commit', '-m', 'image baseline')
  await writeFile(join(root, 'modified.svg'), after)
  await rm(join(root, 'deleted.svg'))
  await git('mv', 'old.svg', 'renamed.svg')
  await writeFile(join(root, 'added.svg'), after)
  await git('add', 'added.svg')
  await writeFile(join(root, 'untracked.SVG'), after)

  const files = await listChangedFiles(root)
  for (const file of files) {
    const diff = await readChangedFileDiff(root, file)
    assert.equal(diff.kind, 'image', file.path)
    assert.equal(diff.oldContents, null)
    assert.equal(diff.newContents, null)
    const expectedOld = ['modified', 'deleted', 'renamed'].includes(file.status) ? before : null
    const expectedNew =
      file.status === 'deleted' ? null : file.status === 'renamed' ? before : after
    for (const [side, expected] of [
      [diff.oldImage, expectedOld],
      [diff.newImage, expectedNew]
    ] as const) {
      if (expected === null) assert.equal(side, null)
      else {
        assert.equal(
          side?.dataUrl,
          `data:image/svg+xml;base64,${Buffer.from(expected).toString('base64')}`
        )
        assert.equal(side?.byteLength, Buffer.byteLength(expected))
      }
    }
  }
  assert.deepEqual(files.map((file) => file.status).sort(), [
    'added',
    'deleted',
    'modified',
    'renamed',
    'untracked'
  ])
})

test('caps image payloads on both sides and preserves text and binary handling', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-image-limit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args: string[]): Promise<unknown> => execFileAsync('git', args, { cwd: root })
  await git('init')
  await git('config', 'user.email', 'test@cerebro.local')
  await git('config', 'user.name', 'Cerebro Test')
  const large = Buffer.alloc(5 * 1024 * 1024 + 1)
  await writeFile(join(root, 'large.png'), large)
  await git('add', '.')
  await git('commit', '-m', 'large image baseline')
  large[0] = 1
  await writeFile(join(root, 'large.png'), large)
  const limited = await readChangedFileDiff(root, {
    path: 'large.png',
    oldPath: null,
    status: 'modified'
  })
  assert.equal(limited.kind, 'image')
  assert.deepEqual(limited.oldImage, { dataUrl: null, byteLength: large.length })
  assert.deepEqual(limited.newImage, { dataUrl: null, byteLength: large.length })
  for (const [path, contents, kind] of [
    ['notes.txt', Buffer.from('hello\n'), 'text'],
    ['data.bin', Buffer.from([0, 1, 2]), 'binary']
  ] as const) {
    await writeFile(join(root, path), contents)
    const diff = await readChangedFileDiff(root, { path, oldPath: null, status: 'untracked' })
    assert.equal(diff.kind, kind)
  }
})
