import { safeSkillName } from './skills'

/**
 * A slash command a harness understands, such as `/compact`. Unlike a skill it is not a chip:
 * the composer inserts plain `/name ` text at the start of the message and the adapter acts on it
 * when the turn runs. Skills and plain prompt templates are listed apart from commands.
 */
export type AgentCommand = {
  id: string
  /** Without the leading slash. Plugin commands keep their qualified name (`plugin:command`). */
  name: string
  description: string
  /** Shown after the name, such as `[instructions]`. Empty when the command takes no argument. */
  argumentHint: string
  /** `builtin` ships with the harness. `custom` comes from the user, a project, a plugin or an extension. */
  source: 'builtin' | 'custom'
}
export type AgentCommandList = {
  commands: AgentCommand[]
  /** Set when the harness could not be asked. The composer still opens, with the built-ins it knows. */
  issue?: string
}

/** Splits a message that is entirely one slash command. Anything else is an ordinary prompt. */
export function parseSlashCommand(text: string): { name: string; args: string } | undefined {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match || !safeSkillName(match[1])) return undefined
  return { name: match[1], args: (match[2] ?? '').trim() }
}
