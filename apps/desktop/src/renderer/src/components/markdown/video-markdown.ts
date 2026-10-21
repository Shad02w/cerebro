import {
  isLocalSource,
  isVideoSource,
  markdownVideoPrefix,
  videoMarkdownSource
} from '@shared/media'

const fence = /^ {0,3}(`{3,}|~{3,})/
const videoTag = /<video\b[^>]*>/gi
const sourceTag = /<source\b[^>]*>/i
// `![alt](<destination> "title")`: the destination is either angle-wrapped or a bare token.
const markdownImage = /(!\[[^\]]*\]\(\s*)(<([^>\n]+)>|([^)\s]+))(\s*(?:"[^"\n]*"|'[^'\n]*')?\s*\))/g

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'i'
  ).exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

/** Replaces a tag attribute, or adds it when the agent's tag does not set it. */
function setAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`((?:^|\\s)${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s"'>]+)`, 'i')
  if (!pattern.test(tag)) {
    const closing = tag.endsWith('/>') ? '/>' : '>'
    return `${tag.slice(0, -closing.length)} ${name}="${escapeAttribute(value)}"${closing}`
  }
  return tag.replace(pattern, (_match, prefix: string) => `${prefix}"${escapeAttribute(value)}"`)
}

/**
 * Markdown sanitization drops unknown schemes, so a `file:` source never reaches the renderer.
 * Local sources are swapped for an opaque relative path that the video component decodes again.
 */
function protectSource(value: string | undefined, kind: 'video' | 'poster'): string | null {
  if (!value) return null
  const source = value.trim()
  if (!source || source.startsWith(markdownVideoPrefix)) return null
  if (!isLocalSource(source)) return null
  if (kind === 'video' && !isVideoSource(source)) return null
  return videoMarkdownSource(source)
}

function protectVideoTags(chunk: string): string {
  return chunk.replace(videoTag, (tag, offset: number, whole: string) => {
    let next = tag
    const poster = protectSource(attribute(tag, 'poster'), 'poster')
    if (poster) next = setAttribute(next, 'poster', poster)

    const src = attribute(tag, 'src')
    if (src) {
      const protectedSource = protectSource(src, 'video')
      return protectedSource ? setAttribute(next, 'src', protectedSource) : next
    }

    // `<video><source src="…" type="video/mp4"></video>`: hoist the first source onto the tag.
    const start = Number(offset) + tag.length
    const close = whole.toLowerCase().indexOf('</video>', start)
    const nested = sourceTag.exec(close < 0 ? '' : whole.slice(start, close))
    const nestedSource = nested ? protectSource(attribute(nested[0], 'src'), 'video') : null
    return nestedSource ? setAttribute(next, 'src', nestedSource) : next
  })
}

function protectVideoImages(chunk: string): string {
  return chunk.replace(
    markdownImage,
    (match, head: string, _destination: string, wrapped: string, bare: string, tail: string) => {
      const protectedSource = protectSource(wrapped ?? bare, 'video')
      if (!protectedSource) return match
      return `${head}<${protectedSource}>${tail}`
    }
  )
}

/** Applies `transform` to every line outside fenced code blocks, where video is documentation. */
function outsideFences(text: string, transform: (chunk: string) => string): string {
  const output: string[] = []
  const plain: string[] = []
  let openFence: string | null = null
  const flush = (): void => {
    if (plain.length === 0) return
    output.push(transform(plain.join('\n')))
    plain.length = 0
  }
  for (const line of text.split('\n')) {
    const marker = fence.exec(line)?.[1]
    if (marker) {
      if (openFence === null) {
        flush()
        openFence = marker
      } else if (marker[0] === openFence[0] && marker.length >= openFence.length) {
        openFence = null
      }
      output.push(line)
      continue
    }
    if (openFence === null) plain.push(line)
    else output.push(line)
  }
  flush()
  return output.join('\n')
}

/**
 * Prepares agent markdown for the memoized block parser. Raw `<video>` tags and `file:` video
 * images become a sanitize-safe local source that `MarkdownVideo` turns into a player.
 */
export function prepareVideoMarkdown(text: string): string {
  if (!/<video\b/i.test(text) && !/\.(?:mp4|m4v|mov|webm|ogv|ogg|mkv)(?:[?#\s)]|$)/i.test(text))
    return text
  return outsideFences(text, (chunk) => protectVideoImages(protectVideoTags(chunk)))
}
