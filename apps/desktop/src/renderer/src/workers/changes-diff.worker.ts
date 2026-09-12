import { parseDiffFromFile } from '@pierre/diffs'
import type { ParseDiffRequest, ParseDiffResponse } from '../lib/changes-diff-worker'

self.onmessage = ({ data }: MessageEvent<ParseDiffRequest>): void => {
  try {
    const fileDiff = parseDiffFromFile(data.oldFile, data.newFile)
    // Identify this content snapshot for Pierre's highlight cache.
    fileDiff.cacheKey = crypto.randomUUID()
    self.postMessage({ id: data.id, fileDiff } satisfies ParseDiffResponse)
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : 'Failed to compute diff.'
    } satisfies ParseDiffResponse)
  }
}
