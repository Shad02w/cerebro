import workerUrl from '@pierre/diffs/worker/worker-portable.js?url'
import type { WorkerPoolOptions, WorkerInitializationRenderOptions } from '@pierre/diffs/react'

export const changesWorkerPool: WorkerPoolOptions = {
  // The portable worker is a standalone asset and works with Electron's file:// renderer.
  workerFactory: () => new Worker(workerUrl, { name: 'changes-highlight' }),
  poolSize: 2,
  totalASTLRUCacheSize: 50
}

// Both palettes load once; `themeType` on each diff picks the one matching the color mode.
export const DIFF_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const

// Paint the diff canvas with the app's opaque surface so every UI style lines up with the panes around it.
export const DIFF_SURFACE_CSS = `
  :host {
    --diffs-dark-bg: var(--background);
    --diffs-light-bg: var(--background);
  }
`

export const changesHighlighterOptions: WorkerInitializationRenderOptions = {
  theme: DIFF_THEMES,
  preferredHighlighter: 'shiki-js'
}
