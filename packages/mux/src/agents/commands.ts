import { safeSkillName, type AgentCommand } from '@cerebro/core'
import type { Frame } from './transport'

const command = (
  harness: string,
  name: string,
  description: string,
  source: AgentCommand['source'],
  argumentHint = ''
): AgentCommand => ({
  id: `${harness}:${name}`,
  name,
  description: description.replace(/\s+/g, ' ').trim(),
  argumentHint,
  source
})

/*
 * Commands that start, replace, switch or rename the conversation (/new, /fork, /resume, /clear,
 * /rename ...) are left out of every list. Cerebro owns sessions and their titles: New Agent,
 * fork-from-a-turn, the session list and naming already do this, and the adapter must not swap its native conversation underneath the app.
 * Codex and Pi are whitelists, because Cerebro owns those tables. Claude's list comes from the
 * SDK, so it is a blacklist (below).
 */

/**
 * Commands Codex's TUI parses client-side. `codex app-server` has no listing and does not read a
 * leading `/` in `turn/start`, so the Codex adapter maps each one to the RPC that does the work.
 */
export const codexCommands: readonly AgentCommand[] = [
  command('codex', 'compact', 'Summarize the conversation to free up context', 'builtin'),
  command('codex', 'review', 'Review the uncommitted changes and find issues', 'builtin'),
  command('codex', 'init', 'Create an AGENTS.md with instructions for Codex', 'builtin')
]

/**
 * Pi's built-in TUI commands run only in interactive mode, and `get_commands` leaves them out.
 * The Pi adapter maps each one to the RPC method that does the same work.
 */
export const piNativeCommands: readonly AgentCommand[] = [
  command('pi', 'compact', 'Compact the conversation context', 'builtin', '[instructions]'),
  command('pi', 'export', 'Export this session to an HTML file', 'builtin')
]

/** One slash command Claude Code reported (`Query.supportedCommands()`). */
export type ClaudeSlashCommand = {
  name?: string
  aliases?: string[]
  description?: string
  argumentHint?: string
  builtin?: boolean
}

/**
 * Claude commands that switch or rename the conversation, or that Cerebro already offers as a picker
 * (model, access mode) or does not support (sign-in, quitting). A command is hidden when its
 * name or any alias is listed, so `/reset` cannot reach `/clear` through the back door.
 */
export const claudeHiddenCommands: ReadonlySet<string> = new Set([
  'clear',
  'reset',
  'new',
  'resume',
  'continue',
  'rewind',
  'checkpoint',
  'fork',
  'branch',
  'exit',
  'quit',
  'login',
  'logout',
  'model',
  'permissions',
  'rename'
])

/**
 * Everything Claude Code accepts as a leading `/name args`. Claude parses these from the prompt, so
 * the adapter sends them as ordinary text. Skills appear here too; the composer lists a name once.
 */
export function claudeCommands(commands: readonly ClaudeSlashCommand[]): AgentCommand[] {
  const found = new Map<string, AgentCommand>()
  for (const entry of commands) {
    const name = String(entry?.name ?? '').replace(/^\//, '')
    if (!safeSkillName(name) || found.has(name)) continue
    if ([name, ...(entry.aliases ?? [])].some((alias) => claudeHiddenCommands.has(alias))) continue
    found.set(
      name,
      command(
        'claude',
        name,
        String(entry.description ?? ''),
        entry.builtin ? 'builtin' : 'custom',
        String(entry.argumentHint ?? '')
      )
    )
  }
  return sorted([...found.values()])
}

/**
 * Pi `get_commands` without skills (those are the skill picker's), plus the built-ins Pi leaves out.
 * An extension that reuses a built-in name wins, as it does in Pi.
 */
export function piCommands(result: Frame): AgentCommand[] {
  const listed = Array.isArray(result.commands) ? result.commands : []
  const found = new Map<string, AgentCommand>()
  for (const entry of listed) {
    if (!entry || entry.source === 'skill') continue
    const name = String(entry.name ?? '').replace(/^\//, '')
    if (!safeSkillName(name) || found.has(name)) continue
    found.set(name, command('pi', name, String(entry.description ?? ''), 'custom'))
  }
  for (const entry of piNativeCommands) if (!found.has(entry.name)) found.set(entry.name, entry)
  return sorted([...found.values()])
}

const sorted = (commands: AgentCommand[]): AgentCommand[] =>
  commands.sort((left, right) => left.name.localeCompare(right.name))
