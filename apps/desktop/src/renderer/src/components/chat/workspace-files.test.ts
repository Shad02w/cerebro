import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createMentionFileListing,
  loadWorkspaceFiles,
  type WorkspaceFileIndex
} from './workspace-files'

function stubFiles(read: () => readonly string[]): { calls: number } {
  const calls = { calls: 0 }
  ;(globalThis as { window: Window }).window = {
    cerebro: {
      listWorkspaceFiles: () => {
        calls.calls += 1
        return Promise.resolve([...read()])
      }
    }
  } as unknown as Window
  return calls
}

test('an @ menu reads the directory once and the next menu reads it again', async () => {
  let files = ['README.md']
  const calls = stubFiles(() => files)
  const index: WorkspaceFileIndex = { current: new Set(), generation: 0 }
  const listing = createMentionFileListing({ current: 4 }, index)
  listing.begin()
  const first = listing.files()
  assert.equal(listing.files(), first)
  assert.deepEqual(await first, ['README.md'])
  assert.equal(calls.calls, 1)
  assert.deepEqual([...index.current], ['README.md'])

  files = ['README.md', 'src/added.ts']
  listing.begin()
  assert.deepEqual(await listing.files(), ['README.md', 'src/added.ts'])
  assert.equal(calls.calls, 2)
  assert.ok(index.current.has('src/added.ts'))
})

test('an older directory read does not replace files found by a later @', async () => {
  let releaseOlder: (files: string[]) => void = () => {}
  const older = new Promise<string[]>((resolve) => {
    releaseOlder = resolve
  })
  let calls = 0
  ;(globalThis as { window: Window }).window = {
    cerebro: {
      listWorkspaceFiles: () => {
        calls += 1
        return calls === 1 ? older : Promise.resolve(['README.md', 'src/added.ts'])
      }
    }
  } as unknown as Window
  const index: WorkspaceFileIndex = { current: new Set(), generation: 0 }
  const generation = ++index.generation
  const stale = loadWorkspaceFiles(9).then((listed) => {
    if (index.generation === generation) index.current = new Set(listed)
  })
  const listing = createMentionFileListing({ current: 9 }, index)
  listing.begin()
  assert.deepEqual(await listing.files(), ['README.md', 'src/added.ts'])
  releaseOlder(['README.md'])
  await stale
  assert.deepEqual([...index.current].sort(), ['README.md', 'src/added.ts'])
})
