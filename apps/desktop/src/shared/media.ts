/** Media helpers shared by the renderer, its markdown pipeline, and the main-process media protocol. */

export const mediaScheme = 'cerebro-media'
export const mediaUrlHost = 'local'
/** Markdown image sources that carry a local video file instead of an image or a URL. */
export const markdownVideoPrefix = '/@cerebro-video/'

const videoExtensions = ['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.ogg', '.mkv'] as const

const mediaTypes: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** Lowercase extension of a source, ignoring a query or fragment. */
function extensionOf(value: string): string {
  const path = value.trim().split(/[?#]/)[0]
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dot = path.lastIndexOf('.')
  return dot > separator ? path.slice(dot).toLowerCase() : ''
}

export function isVideoSource(value: string): boolean {
  return (videoExtensions as readonly string[]).includes(extensionOf(value))
}

/** MIME type for a local media file, or undefined when the extension is not supported. */
export function mediaType(value: string): string | undefined {
  return mediaTypes[extensionOf(value)]
}

/** Whether an agent-written source could be a file on this machine. Remote URLs are never fetched. */
export function isLocalSource(value: string): boolean {
  const source = value.trim()
  if (!source) return false
  if (/^file:/i.test(source)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) return false
  return true
}

/** Encodes a local source as an opaque markdown destination that survives sanitization. */
export function videoMarkdownSource(source: string): string {
  return `${markdownVideoPrefix}${encodeURIComponent(source.trim())}`
}

/** Returns the local source behind a markdown video destination, or null for any other markdown. */
export function readVideoMarkdownSource(source: string): string | null {
  if (!source.startsWith(markdownVideoPrefix)) return null
  try {
    return decodeURIComponent(source.slice(markdownVideoPrefix.length))
  } catch {
    return null
  }
}

/** URL the media protocol serves for a local source. */
export function mediaUrl(source: string): string {
  return `${mediaScheme}://${mediaUrlHost}/${encodeURIComponent(source.trim())}`
}

/** Local source encoded in a media protocol URL, or null when the URL is not one of ours. */
export function mediaSourceFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${mediaScheme}:` || parsed.host !== mediaUrlHost) return null
  try {
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  } catch {
    return null
  }
}
