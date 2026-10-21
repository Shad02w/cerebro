import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { mediaScheme, mediaSourceFromUrl } from '../shared/media'
import { parseByteRange, resolveMediaFile } from './media-source'

const unavailable = (): Response => new Response('Not found', { status: 404 })

/**
 * The renderer cannot load `file:` media, so agent replies stream local images and videos through
 * this scheme. It must be registered before the app is ready.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: mediaScheme,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

/** Serves local media with `Range` support so the video player can seek without reading it all. */
export function registerMediaProtocol(): void {
  protocol.handle(mediaScheme, async (request) => {
    const source = mediaSourceFromUrl(request.url)
    if (!source) return unavailable()

    let file: ReturnType<typeof resolveMediaFile>
    let size: number
    try {
      file = resolveMediaFile(source)
      const info = await stat(file.path)
      if (!info.isFile()) return unavailable()
      size = info.size
    } catch {
      return unavailable()
    }

    const headers = {
      'Content-Type': file.contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }
    if (request.method === 'HEAD')
      return new Response(null, {
        status: 200,
        headers: { ...headers, 'Content-Length': String(size) }
      })
    if (size === 0) return new Response(null, { status: 200, headers })

    const range = parseByteRange(request.headers.get('range'), size)
    if (range === 'invalid')
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${size}` }
      })

    const start = range?.start ?? 0
    const end = range?.end ?? size - 1
    const body = Readable.toWeb(createReadStream(file.path, { start, end })) as ReadableStream
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
      }
    })
  })
}
