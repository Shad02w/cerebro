import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChatAttachmentContent, ChatImageType } from '@cerebro/core'

/** Local images an agent reply may show. Larger than composer attachments: these are screenshots and renders. */
export const chatImageMaxBytes = 10 * 1024 * 1024

const mimeTypes: Record<string, ChatImageType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

function decode(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

/** Turns a markdown image source into an absolute local path. Remote sources are rejected. */
export function resolveChatImagePath(source: string): string {
  const value = source.trim()
  let path: string
  if (/^file:/i.test(value)) path = fileURLToPath(value)
  else if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value))
    throw new Error('Only local images can be shown.')
  else if (value === '~' || value.startsWith('~/')) path = join(homedir(), decode(value.slice(1)))
  else path = decode(value)
  if (!isAbsolute(path)) throw new Error('Only absolute image paths can be shown.')
  return path
}

/** Reads a local image file for an agent reply as base64. Never fetches over the network. */
export async function readChatImage(source: string): Promise<ChatAttachmentContent> {
  const path = resolveChatImagePath(source)
  const mimeType = mimeTypes[extname(path).toLowerCase()]
  if (!mimeType) throw new Error('Unsupported image type.')
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Not a file.')
  if (info.size > chatImageMaxBytes) throw new Error('Image is too large.')
  return { mimeType, data: (await readFile(path)).toString('base64') }
}
