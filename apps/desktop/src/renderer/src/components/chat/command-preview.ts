import type { ChatItem } from '@cerebro/core'

/** Visible length of a collapsed command before the `....` marker. */
export const COMMAND_PREVIEW_LENGTH = 80

const SHELL_TOOLS = new Set(['bash', 'shell', 'powershell', 'cmd', 'terminal'])

/** Display name for a shell tool, matching the way `Read` is written. */
const SHELL_LABELS: Record<string, string> = {
  bash: 'Bash',
  shell: 'Shell',
  powershell: 'PowerShell',
  cmd: 'Cmd',
  terminal: 'Terminal'
}

type CommandFields = Pick<ChatItem, 'kind' | 'title' | 'input' | 'text'>

export type CommandRun = {
  /** The shell command, when the row has one. */
  command: string
  /** Tool name shown like other calls: `Bash`, or `Shell` when the title is the command. */
  label: string
  /** One line: `Bash <command>`, ending in `....` when it is longer. */
  preview: string
}

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim()

const DESCRIPTION_KEYS = [
  'description',
  'query',
  'file_path',
  'path',
  'pattern',
  'url',
  'subject',
  'prompt',
  'command'
] as const

/** Pull one string field out of tool input, including a still-streaming JSON fragment. */
function stringField(input: string | undefined, key: string): string | null {
  if (!input?.trim()) return null
  const trimmed = input.trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string') return key === 'command' ? oneLine(parsed) || null : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>)[key]
      if (typeof value === 'string') return oneLine(value) || null
    }
    return null
  } catch {
    const match = trimmed.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`))
    if (!match?.[1]) return null
    try {
      return oneLine(JSON.parse(`"${match[1]}"`) as string) || null
    } catch {
      return oneLine(match[1]) || null
    }
  }
}

/** Pull `command` out of a tool input object, including a still-streaming JSON fragment. */
function commandFromInput(input: string | undefined): string | null {
  return stringField(input, 'command')
}

/** Tool names from the harnesses use a capital letter (`Bash`, `Read`, `webSearch`). */
function isToolName(title: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(title) && /[A-Z]/.test(title)
}

function shellLabel(title: string): string {
  return SHELL_LABELS[title.toLowerCase()] ?? 'Shell'
}

function cutLine(line: string): string {
  if (line.length <= COMMAND_PREVIEW_LENGTH) return line
  return `${line.slice(0, COMMAND_PREVIEW_LENGTH).trimEnd()}....`
}

/** `Bash · <what it did>`, cut to one line with `....` when it is longer. */
function collapsedLine(label: string, description: string | null): string {
  return cutLine(description ? `${label} · ${description}` : label)
}

/**
 * Bash and shell rows. Claude names the tool `Bash` and puts the command in `input`.
 * Codex puts the command in the title. Other tools stay null.
 */
export function commandRun(item: CommandFields): CommandRun | null {
  if (item.kind !== 'tool') return null
  const title = item.title?.trim() ?? ''
  const fromInput = commandFromInput(item.input)
  const shellTool = SHELL_TOOLS.has(title.toLowerCase())
  const label = shellLabel(title)
  let command: string | null = null
  if (shellTool) command = fromInput ?? ''
  else if (fromInput) command = fromInput
  else if (title && !isToolName(title)) command = title
  else return null

  const commandFlat = oneLine(command)
  if (!commandFlat && !shellTool) return null
  return { command: commandFlat, label, preview: collapsedLine(label, commandFlat) }
}

export type ToolCallSummary = {
  label: string
  /** What the call is about: a description, path, query, or the command. */
  description: string | null
  /** `Read · a.ts`, or `Bash · Say hello`. */
  line: string
}

/** One line for any tool call. The description is never the status word. */
export function toolCallSummary(item: CommandFields): ToolCallSummary {
  const run = commandRun(item)
  const label = (run?.label ?? item.title?.trim()) || 'Tool'
  let description: string | null = null
  for (const key of DESCRIPTION_KEYS) {
    const value = stringField(item.input, key)
    if (value) {
      description = value
      break
    }
  }
  if (!description && run?.command) description = run.command
  return { label, description, line: collapsedLine(label, description) }
}

/** Input fields other than the command itself, shown only after the row is expanded. */
export function commandInputDetail(input: string | undefined, command: string): string | null {
  if (!input?.trim() || input.trim() === command) return null
  try {
    const parsed = JSON.parse(input) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rest = { ...(parsed as Record<string, unknown>) }
      delete rest.command
      const remaining = Object.entries(rest).filter(([, value]) => value != null && value !== '')
      if (remaining.length === 0) return null
      return JSON.stringify(Object.fromEntries(remaining), null, 2)
    }
  } catch {
    return input
  }
  return input
}
