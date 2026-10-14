import { safeSkillName, skillPromptFor, skillTokenFor, type AgentSkill } from '@cerebro/core'
import type { Frame } from './transport'

/** One slash skill Claude Code reported. Extra fields are kept when the CLI sends them. */
export type ClaudeSkillCommand = {
  name?: string
  description?: string
  builtin?: boolean
  /** False when the skill is not a user slash command. Absent means Claude listed it as invocable. */
  userInvocable?: boolean
  path?: string
}

/**
 * The skills a Claude Code session exposed.
 * Plugin skills keep the qualified name (`plugin:skill`). Built-in commands and
 * skills Claude marked non-invocable stay out of the picker.
 */
export function claudeExposedSkills(commands: readonly ClaudeSkillCommand[]): AgentSkill[] {
  const found = new Map<string, AgentSkill>()
  for (const command of commands) {
    if (!command || command.builtin || command.userInvocable === false) continue
    const name = String(command.name ?? '').replace(/^\//, '')
    if (!safeSkillName(name) || found.has(name)) continue
    const path = typeof command.path === 'string' ? command.path : ''
    found.set(name, {
      id: path || `claude:${name}`,
      name,
      description: String(command.description ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
      path,
      token: skillTokenFor('claude', name),
      prompt: skillPromptFor('claude', name)
    })
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/** Maps a Codex `skills/list` result. Disabled skills stay out of the picker. */
export function codexSkills(result: Frame, cwd?: string): AgentSkill[] {
  const data = Array.isArray(result.data) ? result.data : []
  const entry =
    (cwd ? data.find((item: Frame) => item && String(item.cwd) === cwd) : undefined) ?? data[0]
  const found = new Map<string, AgentSkill>()
  for (const skill of entry?.skills ?? []) {
    if (!skill || skill.enabled === false) continue
    const name = String(skill.name ?? '')
    if (!safeSkillName(name) || found.has(name)) continue
    const path = typeof skill.path === 'string' ? skill.path : ''
    const description = String(
      skill.interface?.shortDescription || skill.shortDescription || skill.description || ''
    ).trim()
    found.set(name, {
      id: path || `codex:${name}`,
      name,
      description,
      path,
      token: skillTokenFor('codex', name),
      prompt: skillPromptFor('codex', name)
    })
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/** Maps Pi `get_commands`, keeping only skill commands (`skill:name` → `name`). */
export function piSkills(result: Frame): AgentSkill[] {
  const commands = Array.isArray(result.commands) ? result.commands : []
  const found = new Map<string, AgentSkill>()
  for (const command of commands) {
    if (!command || command.source !== 'skill') continue
    const raw = String(command.name ?? '')
    const name = raw.startsWith('skill:') ? raw.slice('skill:'.length) : raw
    if (!safeSkillName(name) || found.has(name)) continue
    const path = String(command.sourceInfo?.path ?? command.path ?? '')
    found.set(name, {
      id: path || `pi:${raw}`,
      name,
      description: String(command.description ?? '').trim(),
      path,
      token: skillTokenFor('pi', name),
      prompt: skillPromptFor('pi', name)
    })
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name))
}
