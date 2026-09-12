import type { FileContents, FileDiffMetadata } from '@pierre/diffs'
import ChangesDiffWorker from '../workers/changes-diff.worker?worker'

export type ParseDiffRequest = {
  id: number
  oldFile: FileContents | null
  newFile: FileContents | null
}

export type ParseDiffResponse =
  | { id: number; fileDiff: FileDiffMetadata; error?: never }
  | { id: number; error: string; fileDiff?: never }

/** A refresh owns its worker; cancellation stops even an in-progress synchronous parse. */
export function createChangesDiffWorker(signal: AbortSignal): {
  parse: (oldFile: FileContents | null, newFile: FileContents | null) => Promise<FileDiffMetadata>
  dispose: () => void
} {
  signal.throwIfAborted()
  // Vite selects a module worker in dev and a bundled classic worker for file:// builds.
  const worker = new ChangesDiffWorker({ name: 'changes-diff' })
  let nextId = 0
  let stopped: Error | undefined
  const pending = new Map<
    number,
    { resolve: (diff: FileDiffMetadata) => void; reject: (error: Error) => void }
  >()
  const stop = (error: Error): void => {
    if (stopped) return
    stopped = error
    signal.removeEventListener('abort', abort)
    worker.terminate()
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  const abort = (): void => stop(new DOMException('Changes refresh cancelled.', 'AbortError'))
  signal.addEventListener('abort', abort, { once: true })
  worker.onmessage = ({ data }: MessageEvent<ParseDiffResponse>): void => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.error !== undefined) request.reject(new Error(data.error))
    else request.resolve(data.fileDiff)
  }
  worker.onerror = (event): void => {
    event.preventDefault()
    stop(new Error(event.message || 'Failed to start the diff worker.'))
  }
  worker.onmessageerror = (): void => stop(new Error('Could not read the diff worker response.'))

  return {
    parse: (oldFile, newFile) =>
      new Promise((resolve, reject) => {
        if (stopped) return reject(stopped)
        const id = nextId++
        pending.set(id, { resolve, reject })
        try {
          worker.postMessage({ id, oldFile, newFile } satisfies ParseDiffRequest)
        } catch (error) {
          pending.delete(id)
          reject(error)
        }
      }),
    dispose: abort
  }
}
