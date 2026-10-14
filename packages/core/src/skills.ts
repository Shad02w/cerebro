import type { AgentHarness } from './chat'

/**
 * A skill the composer can mention. `token` is what the transcript shows.
 * `prompt` is the text the harness must actually receive.
 *
 * Codex reads `$name` in the prompt and a separate skill input (`name` + `path`).
 * Claude Code dispatches `/name`. Pi expands `/skill:name` before the model sees it.
 * The composer opens the list with `$` for Codex and `@` for Claude and Pi.
 */
export type AgentSkill = {
  id: string
  name: string
  description: string
  /** Absolute path to the skill file. Codex sends this on the skill input. */
  path: string
  token: string
  prompt: string
}
export type AgentSkillList = {
  skills: AgentSkill[]
  /** Set when the harness could not be asked. The composer still opens, with an empty list. */
  issue?: string
}
/** Name and path the composer resolved. The host derives `token` and `prompt` for the harness. */
export type ChatSkillRef = { name: string; path: string }
export type ChatSkillMention = ChatSkillRef & { token: string; prompt: string }

/**
 * A skill name Claude, Codex, or Pi will dispatch.
 * Plugin skills are `plugin:skill`. Directory-scoped Claude skills are `apps/web:deploy`.
 */
const skillNamePattern =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:[/:][A-Za-z0-9][A-Za-z0-9_-]{0,63}){0,8}$/
/** Characters that can continue a skill token, so `@plugin` does not match inside `@plugin:skill`. */
const skillNameChars = 'A-Za-z0-9_/:-'

export function safeSkillName(name: string): boolean {
  return skillNamePattern.test(name)
}

/** Character that opens the skill list for this harness. */
export function skillTrigger(harness: AgentHarness): '$' | '@' {
  return harness === 'codex' ? '$' : '@'
}

export function skillTokenFor(harness: AgentHarness, name: string): string {
  return `${skillTrigger(harness)}${name}`
}

/** Invocation the harness process expects inside the user prompt. */
export function skillPromptFor(harness: AgentHarness, name: string): string {
  if (harness === 'codex') return skillTokenFor(harness, name)
  if (harness === 'pi') return `/skill:${name}`
  return `/${name}`
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const bounded = (token: string): RegExp =>
  new RegExp(`${escapeRegExp(token)}(?![${skillNameChars}])`, 'g')

/**
 * Rewrites display tokens into the harness prompt. Fenced and inline code stay literal so a
 * skill name inside a sample is not dispatched.
 */
export function skillPromptText(text: string, skills: readonly ChatSkillMention[]): string {
  const replacements = [...skills]
    .filter((skill) => skill.token && skill.prompt && skill.token !== skill.prompt)
    .sort((left, right) => right.token.length - left.token.length)
  if (!replacements.length) return text
  let fenced = false
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('```')) {
        fenced = !fenced
        return line
      }
      if (fenced) return line
      const parts = line.split(/(`[^`]*`)/g)
      return parts
        .map((part, index) => {
          if (index % 2 === 1) return part
          let next = part
          for (const skill of replacements) next = next.replace(bounded(skill.token), skill.prompt)
          return next
        })
        .join('')
    })
    .join('\n')
}

const cleanPath = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const path = value.trim()
  if (!path || path.length > 4096 || /[\0\r\n]/.test(path)) return ''
  return path
}

/**
 * Checks composer skill refs and fills in the token and prompt for `harness`.
 * A ref whose token is not in the message is rejected so a client cannot attach a skill it did not mention.
 */
export function skillMentionsFor(
  harness: AgentHarness,
  text: string,
  input: unknown
): ChatSkillMention[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) throw new Error('Invalid skills.')
  if (input.length > 20) throw new Error('Mention at most 20 skills.')
  const seen = new Set<string>()
  const mentions: ChatSkillMention[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid skill.')
    const name = (entry as { name?: unknown }).name
    if (typeof name !== 'string' || !safeSkillName(name)) throw new Error('Invalid skill.')
    if (seen.has(name)) continue
    const token = skillTokenFor(harness, name)
    if (!bounded(token).test(text)) throw new Error('Skill mention is missing from the message.')
    seen.add(name)
    mentions.push({
      name,
      path: cleanPath((entry as { path?: unknown }).path),
      token,
      prompt: skillPromptFor(harness, name)
    })
  }
  return mentions
}
