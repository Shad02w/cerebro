import {
  chatAttachmentLimits,
  chatImageMarker,
  chatImageTypes,
  type ChatAttachmentUpload,
  type ChatImageType
} from '@cerebro/core'

/** A tracked `[Image #N]` span. Only spans in this list are chips; look-alike text is plain text. */
export type Chip = { attachmentId: string; start: number; end: number }
export type ComposerDraft = {
  text: string
  attachments: ChatAttachmentUpload[]
  chips: Chip[]
}
export const emptyDraft = (text = ''): ComposerDraft => ({ text, attachments: [], chips: [] })
const byStart = (a: Chip, b: Chip): number => a.start - b.start

/** Rewrites every chip's marker so numbering follows attachment order. */
function renumber(draft: ComposerDraft): ComposerDraft {
  const chips = [...draft.chips].sort(byStart)
  let text = ''
  let cursor = 0
  const next: Chip[] = []
  for (const chip of chips) {
    const index = draft.attachments.findIndex((a) => a.id === chip.attachmentId)
    if (index === -1) continue
    const marker = chatImageMarker(index + 1)
    text += draft.text.slice(cursor, chip.start)
    next.push({
      attachmentId: chip.attachmentId,
      start: text.length,
      end: text.length + marker.length
    })
    text += marker
    cursor = chip.end
  }
  text += draft.text.slice(cursor)
  return { text, attachments: draft.attachments, chips: next }
}

/** Inserts a new attachment's marker at the caret. Returns the caret position after the marker. */
export function insertAttachment(
  draft: ComposerDraft,
  attachment: ChatAttachmentUpload,
  caret: number
): { draft: ComposerDraft; caret: number } {
  const at = Math.max(0, Math.min(caret, draft.text.length))
  const before = draft.text.slice(0, at)
  const after = draft.text.slice(at)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = /^\s/.test(after) ? '' : ' '
  const marker = chatImageMarker(draft.attachments.length + 1)
  const start = at + lead.length
  const inserted = lead.length + marker.length + trail.length
  return {
    draft: {
      text: before + lead + marker + trail + after,
      attachments: [...draft.attachments, attachment],
      chips: [
        ...draft.chips.map((chip) =>
          chip.start >= at
            ? { ...chip, start: chip.start + inserted, end: chip.end + inserted }
            : chip
        ),
        { attachmentId: attachment.id, start, end: start + marker.length }
      ]
    },
    caret: start + marker.length + trail.length
  }
}

/** Removes an attachment, its marker, one adjoining space, and renumbers the rest. */
export function removeAttachment(draft: ComposerDraft, attachmentId: string): ComposerDraft {
  const chip = draft.chips.find((entry) => entry.attachmentId === attachmentId)
  let text = draft.text
  let chips = draft.chips.filter((entry) => entry.attachmentId !== attachmentId)
  if (chip) {
    let { start, end } = chip
    if (text[end] === ' ') end++
    else if (text[start - 1] === ' ') start--
    const removed = end - start
    text = text.slice(0, start) + text.slice(end)
    chips = chips.map((entry) =>
      entry.start >= end
        ? { ...entry, start: entry.start - removed, end: entry.end - removed }
        : entry
    )
  }
  return renumber({
    text,
    attachments: draft.attachments.filter((entry) => entry.id !== attachmentId),
    chips
  })
}

/**
 * Applies a textarea edit to the draft. Any edit touching a chip removes the whole chip and its
 * attachment; other chips shift with the text. `selection` is the selection before the edit.
 */
export function reconcile(
  draft: ComposerDraft,
  nextText: string,
  selection: [number, number] = [draft.text.length, draft.text.length]
): ComposerDraft & { caret?: number } {
  const prev = draft.text
  if (nextText === prev) return draft
  const [selStart, selEnd] = [
    Math.max(0, Math.min(selection[0], prev.length)),
    Math.max(0, Math.min(selection[1], prev.length))
  ]
  const limit = Math.min(prev.length, nextText.length)
  let prefix = 0
  while (prefix < limit && prev[prefix] === nextText[prefix]) prefix++
  prefix = Math.min(prefix, selStart)
  const suffixLimit = Math.min(prev.length - prefix, nextText.length - prefix, prev.length - selEnd)
  let suffix = 0
  while (
    suffix < suffixLimit &&
    prev[prev.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  )
    suffix++
  const changedEnd = prev.length - suffix
  const delta = nextText.length - prev.length
  let text = nextText
  const survivors: Chip[] = []
  const remnants: Array<[number, number]> = []
  for (const chip of [...draft.chips].sort(byStart)) {
    if (chip.end <= prefix) survivors.push(chip)
    else if (chip.start >= changedEnd)
      survivors.push({ ...chip, start: chip.start + delta, end: chip.end + delta })
    else {
      if (chip.start < prefix) remnants.push([chip.start, Math.min(chip.end, prefix)])
      if (chip.end > changedEnd)
        remnants.push([Math.max(chip.start, changedEnd) + delta, chip.end + delta])
    }
  }
  const destroyed = new Set(
    draft.chips
      .filter((chip) => !survivors.some((s) => s.attachmentId === chip.attachmentId))
      .map((chip) => chip.attachmentId)
  )
  let chips = survivors
  let caret: number | undefined
  for (const [start, end] of remnants.sort((a, b) => b[0] - a[0])) {
    caret = start
    const collapse = text[start - 1] === ' ' && text[end] === ' ' ? 1 : 0
    text = text.slice(0, start) + text.slice(end + collapse)
    const removed = end + collapse - start
    chips = chips.map((chip) =>
      chip.start >= end ? { ...chip, start: chip.start - removed, end: chip.end - removed } : chip
    )
  }
  const next = renumber({
    text,
    attachments: draft.attachments.filter((entry) => !destroyed.has(entry.id)),
    chips
  })
  return caret === undefined ? next : { ...next, caret }
}

/** Snaps a caret that landed inside a chip to one of its edges. */
export function snapCaret(
  chips: Chip[],
  position: number,
  direction: 'left' | 'right' | 'nearest' = 'nearest'
): number {
  const chip = chips.find((entry) => position > entry.start && position < entry.end)
  if (!chip) return position
  if (direction === 'left') return chip.start
  if (direction === 'right') return chip.end
  return position - chip.start < chip.end - position ? chip.start : chip.end
}

/** Plain text without tracked markers, safe to persist as a draft. */
export function stripChips(draft: ComposerDraft): string {
  let text = ''
  let cursor = 0
  for (const chip of [...draft.chips].sort(byStart)) {
    text += draft.text.slice(cursor, chip.start)
    cursor = chip.end
    if (draft.text[cursor] === ' ' && (text === '' || /\s$/.test(text))) cursor++
  }
  const rest = text + draft.text.slice(cursor)
  return draft.chips.length ? rest.trimEnd() : rest
}

export const dataUrl = (attachment: { mimeType: string; data: string }): string =>
  `data:${attachment.mimeType};base64,${attachment.data}`

export const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

const encode = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(blob)
  })
const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image.'))),
      type,
      quality
    )
  )

/** Validates, downscales when needed, and encodes an image file for upload. */
export async function prepareImage(file: File): Promise<ChatAttachmentUpload> {
  if (!(chatImageTypes as readonly string[]).includes(file.type))
    throw new Error(`${file.name || 'This file'} is not a PNG, JPEG, GIF, or WebP image.`)
  let mimeType = file.type as ChatImageType
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`${file.name || 'This file'} could not be decoded as an image.`)
  }
  const { maxEdge, maxBytes } = chatAttachmentLimits
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  let width = bitmap.width
  let height = bitmap.height
  let blob: Blob = file
  if (scale < 1 || file.size > maxBytes) {
    width = Math.max(1, Math.round(bitmap.width * scale))
    height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
    if (mimeType === 'image/gif') mimeType = 'image/png'
    blob = await toBlob(canvas, mimeType, mimeType === 'image/png' ? undefined : 0.9)
    if (blob.size > maxBytes) {
      mimeType = 'image/jpeg'
      blob = await toBlob(canvas, mimeType, 0.8)
    }
  }
  bitmap.close()
  if (blob.size > maxBytes)
    throw new Error(
      `${file.name || 'Image'} is still over ${Math.round(maxBytes / 1024 / 1024)} MB after resizing.`
    )
  return {
    id: crypto.randomUUID(),
    kind: 'image',
    name: file.name || 'Pasted image',
    mimeType,
    bytes: blob.size,
    width,
    height,
    data: await encode(blob)
  }
}

/** Image files from a drop or paste, in order. Non-image entries are ignored by the caller's validation. */
export function imageFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return []
  const files = [...transfer.files]
  if (files.length) return files
  return [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}
