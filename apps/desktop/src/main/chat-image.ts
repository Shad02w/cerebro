import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ChatAttachmentContent, ChatImageType } from '@cerebro/core'
import { resolveLocalFilePath } from './local-file'

/** Local images an agent reply may show. Larger than composer attachments: these are screenshots and renders. */
export const chatImageMaxBytes = 10 * 1024 * 1024

const mimeTypes: Record<string, ChatImageType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** Turns a markdown image source into an absolute local path. Remote sources are rejected. */
export const resolveChatImagePath = resolveLocalFilePath

/** Reads a local image file for an agent reply as base64. Never fetches over the network. */
export async function readChatImage(source: string): Promise<ChatAttachmentContent> {
  const path = resolveLocalFilePath(source)
  const mimeType = mimeTypes[extname(path).toLowerCase()]
  if (!mimeType) throw new Error('Unsupported image type.')
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Not a file.')
  if (info.size > chatImageMaxBytes) throw new Error('Image is too large.')
  return { mimeType, data: (await readFile(path)).toString('base64') }
}
