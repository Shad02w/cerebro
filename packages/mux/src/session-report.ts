import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rename, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  chatImageTypes,
  type AgentSession,
  type AgentSubagent,
  type ChatImageType,
  type ChatItem
} from '@cerebro/core'
import { redactDiagnostics } from './diagnostics'
import { log } from './log'
import { createZip, type ZipEntry } from './zip'

/**
 * One conversation, packed so it can be sent with images.
 *
 * The snapshot is that session only: model, status, context usage, and counts.
 * Message text stays out unless the caller opts in. Image bytes are files in
 * the zip, never fields in the JSON. Paths and credential shapes are scrubbed
 * with the same redactor as the diagnostics bundle.
 */
export const sessionReportLimits = {
  maxImages: 8,
  maxImageBytes: 5 * 1024 * 1024,
  maxTotalImageBytes: 20 * 1024 * 1024,
  maxComment: 4_000,
  maxText: 20_000,
  maxItems: 400
} as const

export type SessionReportScore = 'helpful' | 'problem'
export type SessionReportImageSource = 'attached' | 'session'
export type SessionReportImage = {
  id: string
  name: string
  mimeType: ChatImageType
  /** Base64 payload. Written as a file, never into report.json. */
  data: string
  source: SessionReportImageSource
}
export type SessionReportInput = {
  session: AgentSession
  score: SessionReportScore
  comment?: string
  /** When true, redacted message text from this session is included. */
  includeTranscript?: boolean
  images?: SessionReportImage[]
  /** Caller facts, such as the desktop app version. Must not contain user content. */
  app?: Record<string, unknown>
}

export type SessionReportFile = {
  id: string
  name: string
  mimeType: ChatImageType
  bytes: number
  source: SessionReportImageSource
  file: string
}

export type SessionReport = {
  scope: 'session'
  reportId: string
  createdAt: string
  score: SessionReportScore
  comment: string
  includeTranscript: boolean
  app: Record<string, unknown> | null
  session: Record<string, unknown>
  images: SessionReportFile[]
}

export type SessionReportResult = {
  path: string
  bytes: number
  files: Array<{ name: string; bytes: number }>
  images: number
}

const README = `Cerebro session report

One conversation, so a problem can be investigated without the rest of the app.

  report.json    The session's model, status, and setup, plus your rating
  images/        Images you attached, and images from the conversation when you included them

Message text is present only when you chose to include this conversation.
Terminal output, other conversations, and credentials are not included.
Your home directory appears as "~". Review the files before sharing.
`

const extensions: Record<ChatImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export function defaultSessionReportName(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `cerebro-session-report-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`
  )
}

const clip = (text: string, limit: number, redact: (value: string) => string): string => {
  const clean = redact(text)
  if (clean.length <= limit) return clean
  return `${clean.slice(0, limit)}\n[truncated]`
}

const tally = (items: Iterable<string>): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1
  return counts
}

function assertSession(session: AgentSession): void {
  if (
    !session ||
    typeof session !== 'object' ||
    typeof session.id !== 'string' ||
    !session.id ||
    typeof session.workspaceId !== 'number' ||
    !session.model ||
    typeof session.model.harness !== 'string' ||
    !Array.isArray(session.items)
  )
    throw new Error('This conversation cannot be reported.')
}

function imageName(name: string, redact: (value: string) => string): string {
  const base = basename(name.replaceAll('\\', '/'))
    .replace(/[\r\n]/g, '')
    .slice(0, 120)
  return redact(base) || 'image'
}

function decodeImage(data: string): Buffer {
  const compact = data.replace(/\s/g, '')
  const ceiling = Math.ceil(sessionReportLimits.maxImageBytes / 3) * 4 + 8
  if (compact.length > ceiling) throw new Error('An image is too large.')
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact))
    throw new Error('An image attachment is not valid.')
  const bytes = Buffer.from(compact, 'base64')
  if (!bytes.length) throw new Error('An image attachment is empty.')
  if (bytes.length > sessionReportLimits.maxImageBytes) throw new Error('An image is too large.')
  return bytes
}

function takeImages(
  images: SessionReportImage[],
  redact: (value: string) => string
): { files: SessionReportFile[]; entries: ZipEntry[] } {
  if (images.length > sessionReportLimits.maxImages)
    throw new Error(`A report can include up to ${sessionReportLimits.maxImages} images.`)
  const seen = new Set<string>()
  const files: SessionReportFile[] = []
  const entries: ZipEntry[] = []
  let total = 0
  images.forEach((image, index) => {
    if (!image || typeof image.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(image.id))
      throw new Error('An image attachment is not valid.')
    if (seen.has(image.id)) throw new Error('An image attachment is duplicated.')
    seen.add(image.id)
    if (!(chatImageTypes as readonly string[]).includes(image.mimeType))
      throw new Error('Only PNG, JPEG, GIF, and WebP images can be sent.')
    if (image.source !== 'attached' && image.source !== 'session')
      throw new Error('An image attachment is not valid.')
    const bytes = decodeImage(typeof image.data === 'string' ? image.data : '')
    total += bytes.length
    if (total > sessionReportLimits.maxTotalImageBytes)
      throw new Error('The images are too large to send together.')
    const mimeType = image.mimeType
    const file = `images/${String(index + 1).padStart(2, '0')}-${image.id}.${extensions[mimeType]}`
    files.push({
      id: image.id,
      name: imageName(typeof image.name === 'string' ? image.name : 'image', redact),
      mimeType,
      bytes: bytes.length,
      source: image.source,
      file
    })
    entries.push({ name: file, data: bytes })
  })
  return { files, entries }
}

function itemSnapshot(
  item: ChatItem,
  transcript: boolean,
  text: (value: string) => string
): Record<string, unknown> {
  const attachments = (item.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    mimeType: attachment.mimeType,
    bytes: attachment.bytes,
    name: text(attachment.name)
  }))
  return {
    id: item.id,
    turnId: item.turnId,
    kind: item.kind,
    status: item.status,
    textChars: item.text?.length ?? 0,
    ...(transcript
      ? {
          text: text(item.text ?? ''),
          ...(item.title ? { title: text(item.title) } : {}),
          ...(item.input ? { input: text(item.input) } : {})
        }
      : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(item.request
      ? {
          request: {
            id: item.request.id,
            kind: item.request.kind,
            resolved: Boolean(item.request.resolved)
          }
        }
      : {})
  }
}

function subagentSnapshot(
  agent: AgentSubagent,
  transcript: boolean,
  text: (value: string) => string
): Record<string, unknown> {
  return {
    id: agent.id,
    status: agent.status,
    model: agent.model,
    effort: agent.effort,
    tokens: agent.tokens,
    createdAt: agent.createdAt,
    startedAt: agent.startedAt,
    finishedAt: agent.finishedAt,
    durationMs: agent.durationMs,
    ...(transcript
      ? {
          title: text(agent.title ?? ''),
          ...(agent.summary ? { summary: text(agent.summary) } : {})
        }
      : {})
  }
}

/** Builds the session snapshot and the image files that accompany it. */
export function collectSessionReport(
  input: SessionReportInput,
  now = new Date()
): { report: SessionReport; entries: ZipEntry[] } {
  assertSession(input.session)
  if (input.score !== 'helpful' && input.score !== 'problem')
    throw new Error('Choose whether this conversation was helpful or a problem.')
  const redact = (value: string): string => redactDiagnostics(value)
  const text = (value: string): string => clip(value, sessionReportLimits.maxText, redact)
  const transcript = Boolean(input.includeTranscript)
  const session = input.session
  const items = session.items.slice(0, sessionReportLimits.maxItems)
  const { files, entries: imageEntries } = takeImages(input.images ?? [], redact)
  const todo = session.todo
  const report: SessionReport = {
    scope: 'session',
    reportId: randomUUID(),
    createdAt: now.toISOString(),
    score: input.score,
    comment: clip(input.comment ?? '', sessionReportLimits.maxComment, redact),
    includeTranscript: transcript,
    app: input.app ?? null,
    images: files,
    session: {
      id: session.id,
      workspaceId: session.workspaceId,
      repositoryId: session.repositoryId ?? null,
      status: session.status,
      cwd: redact(session.cwd ?? ''),
      model: {
        key: session.model.key,
        instance: session.model.instance,
        harness: session.model.harness,
        provider: session.model.provider,
        id: session.model.id,
        label: session.model.label,
        source: session.model.source,
        available: session.model.available
      },
      reasoning: session.reasoning,
      accessMode: session.accessMode,
      ...(session.error ? { error: text(session.error) } : {}),
      generation: session.generation,
      turnId: session.turnId,
      sequence: session.sequence,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      nativeId: session.nativeId,
      forkedFrom: session.forkedFrom,
      contextUsage: session.contextUsage,
      itemCounts: tally(items.map((item) => item.kind)),
      itemsTruncated: session.items.length > items.length,
      items: items.map((item) => itemSnapshot(item, transcript, text)),
      attachmentCount: session.items.reduce(
        (count, item) => count + (item.attachments?.length ?? 0),
        0
      ),
      ...(todo
        ? {
            todo: {
              total: todo.items.length,
              counts: tally(todo.items.map((item) => item.status)),
              ...(transcript
                ? {
                    items: todo.items.map((item) => ({
                      id: item.id,
                      status: item.status,
                      label: text(item.label)
                    }))
                  }
                : {})
            }
          }
        : {}),
      ...(session.subagents?.length
        ? {
            subagents: session.subagents.map((agent) => subagentSnapshot(agent, transcript, text))
          }
        : {}),
      ...(session.background?.length
        ? {
            background: session.background.map((task) => ({
              id: task.id,
              status: task.status,
              exitCode: task.exitCode,
              startedAt: task.startedAt,
              endedAt: task.endedAt,
              ...(transcript
                ? {
                    title: text(task.title ?? ''),
                    ...(task.summary ? { summary: text(task.summary) } : {})
                  }
                : {})
            }))
          }
        : {}),
      queueCount: session.queue?.length ?? 0,
      ...(transcript && session.queue?.length
        ? {
            queue: session.queue.map((message) => ({
              id: message.id,
              text: text(message.text ?? '')
            }))
          }
        : {}),
      ...(transcript && session.title ? { title: text(session.title) } : {}),
      ...(transcript && session.commands?.length
        ? { commands: session.commands.slice(0, 50).map((command) => text(command)) }
        : {})
    }
  }
  const entries: ZipEntry[] = [
    { name: 'README.txt', data: README, modified: now },
    {
      name: 'report.json',
      data: redact(JSON.stringify(report, null, 2)) + '\n',
      modified: now
    },
    ...imageEntries.map((entry) => ({ ...entry, modified: now }))
  ]
  return { report, entries }
}

export async function exportSessionReport(options: {
  outputPath: string
  input: SessionReportInput
}): Promise<SessionReportResult> {
  log('info', 'session_report.export_started', {})
  const now = new Date()
  let target = resolve(options.outputPath)
  if (existsSync(target) && (await stat(target)).isDirectory())
    target = join(target, defaultSessionReportName(now))
  else if (!target.toLowerCase().endsWith('.zip')) target += '.zip'

  const { report, entries } = collectSessionReport(options.input, now)
  const zip = createZip(entries)
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, zip, { mode: 0o600 })
  await rename(temporary, target)
  const result: SessionReportResult = {
    path: target,
    bytes: zip.length,
    images: report.images.length,
    files: entries.map((entry) => ({
      name: entry.name,
      bytes: Buffer.isBuffer(entry.data) ? entry.data.length : Buffer.byteLength(entry.data)
    }))
  }
  log('info', 'session_report.exported', { bytes: result.bytes, images: result.images })
  return result
}
