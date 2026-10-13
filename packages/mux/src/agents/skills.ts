import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { safeSkillName, skillPromptFor, skillTokenFor, type AgentSkill } from '@cerebro/core'
import type { Frame } from './transport'

/** Home used for user-level skills. Tests point this at an empty directory. */
export const skillHome = (): string => process.env.CEREBRO_SKILL_HOME || homedir()

const parseFrontmatter = (text: string): Record<string, string> => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match?.[1]) return {}
  const fields: Record<string, string> = {}
  const lines = match[1].split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index] ?? '')
    if (!field) continue
    let value = field[2].trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = []
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1] ?? '')) {
        index += 1
        block.push((lines[index] ?? '').trim())
      }
      value = block.join(' ')
    } else if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    )
      value = value.slice(1, -1)
    fields[field[1]] = value
  }
  return fields
}

const claudeSkill = (file: string, fallbackName: string): AgentSkill | null => {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const fields = parseFrontmatter(text)
  if (/^(false|no|0)$/i.test(fields['user-invocable'] ?? '')) return null
  const named = fields.name?.trim()
  const name = named && safeSkillName(named) ? named : fallbackName
  if (!safeSkillName(name)) return null
  return {
    id: file,
    name,
    description: (fields.description ?? '').replace(/\s+/g, ' ').trim(),
    path: file,
    token: skillTokenFor('claude', name),
    prompt: skillPromptFor('claude', name)
  }
}

const remember = (found: Map<string, AgentSkill>, skill: AgentSkill | null): void => {
  if (skill && !found.has(skill.name)) found.set(skill.name, skill)
}

const readEntries = (dir: string): Dirent[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Project and user Claude skills, closest directory first. Commands are the legacy skill files. */
const collectClaudeDir = (root: string, found: Map<string, AgentSkill>): void => {
  for (const entry of readEntries(join(root, '.claude', 'skills'))) {
    if (!entry.isDirectory()) continue
    const file = join(root, '.claude', 'skills', entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    remember(found, claudeSkill(file, entry.name))
  }
  for (const entry of readEntries(join(root, '.claude', 'commands'))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    remember(
      found,
      claudeSkill(join(root, '.claude', 'commands', entry.name), entry.name.slice(0, -3))
    )
  }
}

/** From `cwd` up to the git root. A folder that is not in a repo contributes only itself. */
export const claudeProjectRoots = (cwd: string): string[] => {
  const start = resolve(cwd)
  const chain = [start]
  let current = start
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(current, '.git'))) return chain
    const parent = dirname(current)
    if (parent === current) break
    current = parent
    chain.push(current)
  }
  return [start]
}

export function claudeSkills(cwd: string, home = skillHome()): AgentSkill[] {
  const found = new Map<string, AgentSkill>()
  for (const root of claudeProjectRoots(cwd)) collectClaudeDir(root, found)
  if (resolve(home) !== resolve(cwd)) collectClaudeDir(home, found)
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
