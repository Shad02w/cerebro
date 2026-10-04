import type { Node as ProseNode } from '@tiptap/pm/model'

type JSONContent = {
  type?: string
  attrs?: Record<string, unknown>
  content?: JSONContent[]
  marks?: Array<{ type: string }>
  text?: string
}
import { chatImageMarker, type ChatAttachmentUpload } from '@cerebro/core'
import type { Chip } from './chat-attachments'

export type TagOption = { id: string; label: string }

/** Demo catalog for the Add tag menu. */
export const addTags: TagOption[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' }
]

export const codeLanguages: Array<[string, string]> = [
  ['plaintext', 'Plain text'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['python', 'Python'],
  ['bash', 'Bash'],
  ['json', 'JSON'],
  ['css', 'CSS'],
  ['xml', 'HTML'],
  ['markdown', 'Markdown'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['sql', 'SQL']
]

const tagByLabel = new Map(addTags.map((tag) => [tag.label, tag]))

type Writer = { text: string; chips: Chip[] }

const push = (writer: Writer, value: string): void => {
  writer.text += value
}

const writeInline = (
  node: ProseNode,
  attachments: ChatAttachmentUpload[],
  writer: Writer
): void => {
  node.forEach((child) => {
    if (child.isText) {
      let value = child.text ?? ''
      const marks = new Set(child.marks.map((mark) => mark.type.name))
      if (marks.has('code')) value = `\`${value}\``
      if (marks.has('bold')) value = `**${value}**`
      if (marks.has('italic')) value = `*${value}*`
      if (marks.has('strike')) value = `~~${value}~~`
      push(writer, value)
      return
    }
    if (child.type.name === 'hardBreak') {
      push(writer, '\n')
      return
    }
    if (child.type.name === 'imageChip') {
      const index = attachments.findIndex((item) => item.id === child.attrs.attachmentId)
      if (index < 0) return
      const marker = chatImageMarker(index + 1)
      const start = writer.text.length
      push(writer, marker)
      writer.chips.push({
        attachmentId: String(child.attrs.attachmentId),
        start,
        end: start + marker.length
      })
      return
    }
    if (child.type.name === 'mention') {
      push(writer, `@${child.attrs.label ?? child.attrs.id ?? ''}`)
    }
  })
}

const writeBlock = (node: ProseNode, attachments: ChatAttachmentUpload[], writer: Writer): void => {
  if (node.type.name === 'heading') {
    push(writer, `${'#'.repeat(Number(node.attrs.level) || 1)} `)
    writeInline(node, attachments, writer)
    return
  }
  if (node.type.name === 'codeBlock') {
    const language = typeof node.attrs.language === 'string' ? node.attrs.language : ''
    push(writer, `\`\`\`${language}\n${node.textContent}\n\`\`\``)
    return
  }
  if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
    const ordered = node.type.name === 'orderedList'
    let index = 0
    node.forEach((item) => {
      if (index > 0) push(writer, '\n')
      const marker = ordered ? `${index + 1}. ` : '- '
      index += 1
      const nested: Writer = { text: '', chips: [] }
      let blockIndex = 0
      item.forEach((block) => {
        if (blockIndex > 0) push(nested, '\n')
        blockIndex += 1
        writeBlock(block, attachments, nested)
      })
      const body = nested.text.replaceAll('\n', '\n  ')
      const start = writer.text.length + marker.length
      push(writer, marker + body)
      for (const chip of nested.chips) {
        writer.chips.push({
          attachmentId: chip.attachmentId,
          start: start + chip.start,
          end: start + chip.end
        })
      }
    })
    return
  }
  if (node.type.name === 'blockquote') {
    const nested: Writer = { text: '', chips: [] }
    let index = 0
    node.forEach((block) => {
      if (index > 0) push(nested, '\n')
      index += 1
      writeBlock(block, attachments, nested)
    })
    push(writer, nested.text.replaceAll(/^/gm, '> '))
    for (const chip of nested.chips) {
      writer.chips.push({ ...chip, start: chip.start + 2, end: chip.end + 2 })
    }
    return
  }
  if (node.type.name === 'horizontalRule') {
    push(writer, '---')
    return
  }
  writeInline(node, attachments, writer)
}

/** Markdown the agent receives. Image chips stay `[Image #N]` spans tracked for drafts. */
export function serializeDocument(
  doc: ProseNode,
  attachments: ChatAttachmentUpload[]
): { text: string; chips: Chip[] } {
  const writer: Writer = { text: '', chips: [] }
  let index = 0
  doc.forEach((block) => {
    if (index > 0) push(writer, '\n')
    index += 1
    writeBlock(block, attachments, writer)
  })
  return writer
}

/** Maps a ProseMirror position to an offset in `serializeDocument` text. */
export function serializedOffset(
  doc: ProseNode,
  position: number,
  attachments: ChatAttachmentUpload[]
): number {
  const clamped = Math.max(0, Math.min(position, doc.content.size))
  if (clamped === 0) return 0
  const $pos = doc.resolve(clamped)
  let text = serializeDocument(doc.cut(0, clamped), attachments).text
  if ($pos.parent.type.spec.code && text.endsWith('\n```')) text = text.slice(0, -4)
  return text.length
}

const inlineFromText = (line: string, attachments?: Array<{ id: string }>): JSONContent[] => {
  if (!line) return []
  const parts: JSONContent[] = []
  const pattern = /@(A|B|C)|`([^`]+)`|\[Image #(\d+)\]/g
  let last = 0
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ type: 'text', text: line.slice(last, index) })
    if (match[1]) {
      const tag = tagByLabel.get(match[1])
      if (tag)
        parts.push({
          type: 'mention',
          attrs: { id: tag.id, label: tag.label, mentionSuggestionChar: '@' }
        })
    } else if (match[2]) parts.push({ type: 'text', text: match[2], marks: [{ type: 'code' }] })
    else if (match[3] && attachments) {
      const imageIndex = Number(match[3])
      const attachment = attachments[imageIndex - 1]
      if (attachment)
        parts.push({
          type: 'imageChip',
          attrs: { attachmentId: attachment.id, label: chatImageMarker(imageIndex) }
        })
      else parts.push({ type: 'text', text: match[0] })
    } else parts.push({ type: 'text', text: match[0] })
    last = index + match[0].length
  }
  if (last < line.length) parts.push({ type: 'text', text: line.slice(last) })
  return parts
}

const paragraph = (line: string, attachments?: Array<{ id: string }>): JSONContent => {
  const content = inlineFromText(line, attachments)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

const readFence = (lines: string[], start: number): { node: JSONContent; next: number } => {
  const fence = /^```([\w-]*)\s*$/.exec(lines[start] ?? '')
  const code: string[] = []
  let index = start + 1
  while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
    code.push(lines[index] ?? '')
    index += 1
  }
  if (index < lines.length) index += 1
  const text = code.join('\n')
  return {
    node: {
      type: 'codeBlock',
      attrs: { language: fence?.[1] || null },
      ...(text.length ? { content: [{ type: 'text', text }] } : {})
    },
    next: index
  }
}

/** Parses composer markdown. Only bullets, inline code, and fenced code blocks are structured. */
const parseBlocks = (
  lines: string[],
  start: number,
  attachments?: Array<{ id: string }>
): { nodes: JSONContent[]; next: number } => {
  const nodes: JSONContent[] = []
  let index = start
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.startsWith('```')) {
      const fence = readFence(lines, index)
      nodes.push(fence.node)
      index = fence.next
      continue
    }
    if (/^[-*+] /.test(line)) {
      const items: JSONContent[] = []
      while (index < lines.length && /^[-*+] /.test(lines[index] ?? '')) {
        const first = (lines[index] ?? '').replace(/^[-*+] /, '')
        index += 1
        const nested: string[] = []
        while (index < lines.length && /^ {2,}/.test(lines[index] ?? '')) {
          nested.push((lines[index] ?? '').replace(/^ {2}/, ''))
          index += 1
        }
        const nestedBlocks = parseBlocks(nested, 0, attachments).nodes
        items.push({
          type: 'listItem',
          content: [paragraph(first, attachments), ...nestedBlocks]
        })
      }
      nodes.push({ type: 'bulletList', content: items })
      continue
    }
    nodes.push(paragraph(line, attachments))
    index += 1
  }
  return { nodes, next: index }
}

/**
 * Restores composer markdown. Drafts leave `[Image #N]` as text. Pass attachments to render those
 * markers as chips, which is how a sent message is shown.
 */
export function textToContent(
  text: string,
  options?: { attachments?: Array<{ id: string }> }
): JSONContent {
  if (!text) return { type: 'doc', content: [{ type: 'paragraph' }] }
  const content = parseBlocks(text.split('\n'), 0, options?.attachments).nodes
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}
