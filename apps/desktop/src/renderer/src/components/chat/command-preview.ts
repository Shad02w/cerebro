import type { ChatItem } from '@cerebro/core'

/** Visible length of a collapsed command before the `....` marker. */
export const COMMAND_PREVIEW_LENGTH = 80

const SHELL_TOOLS = new Set(['bash', 'shell', 'powershell', 'cmd', 'terminal'])

type CommandFields = Pick<ChatItem, 'kind' | 'title' | 'input' | 'text'>

export type CommandRun = {
  /** The shell command, when the row has one. */
  command: string
  /** One line shown while the row is collapsed. Longer runs end with `....`. */
  preview: string
}

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim()

/** Pull `command` out of a tool input object, including a still-streaming JSON fragment. */
function commandFromInput(input: string | undefined): string | null {
  if (!input?.trim()) return null
  const trimmed = input.trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string') return oneLine(parsed) || null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const command = (parsed as { command?: unknown }).command
      if (typeof command === 'string') return oneLine(command) || null
    }
    return null
  } catch {
    const match = trimmed.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)/)
    if (!match?.[1]) return null
    try {
      return oneLine(JSON.parse(`"${match[1]}"`) as string) || null
    } catch {
      return oneLine(match[1]) || null
    }
  }
}

/** Tool names from the harnesses use a capital letter (`Bash`, `Read`, `webSearch`). */
function isToolName(title: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(title) && /[A-Z]/.test(title)
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
  let command: string | null = null
  if (shellTool) command = fromInput ?? ''
  else if (fromInput) command = fromInput
  else if (title && !isToolName(title)) command = title
  else return null

  const commandFlat = oneLine(command)
  const output = oneLine(item.text)
  const flat = [commandFlat, output].filter(Boolean).join(' ')
  if (!flat) return null
  const preview =
    flat.length <= COMMAND_PREVIEW_LENGTH
      ? flat
      : `${flat.slice(0, COMMAND_PREVIEW_LENGTH).trimEnd()}....`
  return { command: commandFlat, preview }
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
