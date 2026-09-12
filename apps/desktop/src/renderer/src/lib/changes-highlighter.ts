import workerUrl from '@pierre/diffs/worker/worker-portable.js?url'
import type { WorkerPoolOptions, WorkerInitializationRenderOptions } from '@pierre/diffs/react'

export const changesWorkerPool: WorkerPoolOptions = {
  // The portable worker is a standalone asset and works with Electron's file:// renderer.
  workerFactory: () => new Worker(workerUrl, { name: 'changes-highlight' }),
  poolSize: 2,
  totalASTLRUCacheSize: 50
}

export const changesHighlighterOptions: WorkerInitializationRenderOptions = {
  theme: 'pierre-dark',
  preferredHighlighter: 'shiki-js'
}
