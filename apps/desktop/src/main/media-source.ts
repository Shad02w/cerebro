import { isLocalSource, mediaType } from '../shared/media'
import { resolveLocalFilePath } from './local-file'

export type MediaFile = { path: string; contentType: string }
export type ByteRange = { start: number; end: number }

/**
 * Resolves an agent-written media source to a local file with a supported MIME type. Remote
 * sources and extensions outside the media allowlist are rejected.
 */
export function resolveMediaFile(source: string): MediaFile {
  if (!isLocalSource(source)) throw new Error('Only local media can be shown.')
  // Media fragments (`clip.mp4#t=3`) seek in the player; they are not part of the file name.
  const path = resolveLocalFilePath(source.trim().replace(/#t=.*$/i, ''))
  const contentType = mediaType(path)
  if (!contentType) throw new Error('Unsupported media type.')
  return { path, contentType }
}

/**
 * Parses a single `Range` header for a file of `size` bytes. Returns null when the request has no
 * range and `'invalid'` when the range cannot be satisfied, so the caller can answer with 416.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size === 0) return 'invalid'
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return 'invalid'
  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (suffix <= 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  if (start >= size) return 'invalid'
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1
  if (end < start) return 'invalid'
  return { start, end }
}
