import type { AgentModel } from '@cerebro/core'

/**
 * Picker order. Newest version first, and within one version the most advanced model first.
 * Providers keep separate version scales and stay in catalog order, because Pi mixes vendors.
 */
type Rank = {
  ranked: boolean
  major: number
  minor: number
  date: number
  advancement: number
}

const unranked: Rank = { ranked: false, major: 0, minor: 0, date: 0, advancement: 0 }

const claudeAdvancement: Record<string, number> = {
  fable: 40,
  opus: 30,
  sonnet: 20,
  haiku: 10
}

const claudeDotted = /claude-(opus|sonnet|haiku|fable)-(\d+)\.(\d+)(?:-(\d{8}))?(?=$|[^0-9])/i
const claudeWire = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?(?:-(\d{8}))?(?=$|[^0-9])/i
const claudeLegacy = /claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku|fable)(?:-(\d{8}))?(?=$|[^0-9])/i
const claudeLabel = /\b(Opus|Sonnet|Haiku|Fable)\s+(\d+)(?:\.(\d+))?\b/

const gptWire = /^gpt-(\d+)(?:\.(\d+))?o?(?:-(.+))?$/i
const oSeriesWire = /^o(\d+)(?:-(.+))?$/i
const gptLabel = /\bgpt[-\s]?(\d+)(?:\.(\d+))?(?:\s+|-)?(pro|max|mini|nano|codex)?\b/i

const geminiWire = /^gemini-(\d+)(?:\.(\d+))?-(.+)$/i

function rank(major: number, minor: number, date: number, advancement: number): Rank {
  return { ranked: true, major, minor, date, advancement }
}

function claudeRank(family: string, major: number, minor: number, date: number): Rank {
  return rank(major, minor, date, claudeAdvancement[family.toLowerCase()] ?? 0)
}

/** Drop the router prefix and a `:batch` / `:free` suffix so `openai/gpt-5.4-mini:batch` parses. */
function modelSlug(id: string): string {
  return id.replace(/^~/, '').split('/').pop()?.split(':')[0] ?? id
}

function variantPenalty(id: string): number {
  if (/:batch\b/i.test(id)) return -1
  if (/:free\b/i.test(id)) return -2
  return 0
}

function adjust(model: AgentModel, parsed: Rank | undefined): Rank | undefined {
  if (!parsed) return undefined
  return { ...parsed, advancement: parsed.advancement + variantPenalty(model.id) }
}

function parseClaude(model: AgentModel): Rank | undefined {
  const slug = modelSlug(model.id)
  const dotted = claudeDotted.exec(slug) ?? claudeDotted.exec(model.label)
  if (dotted)
    return claudeRank(dotted[1], Number(dotted[2]), Number(dotted[3]), Number(dotted[4] ?? 0))
  const wire = claudeWire.exec(slug) ?? claudeWire.exec(model.label)
  if (wire) return claudeRank(wire[1], Number(wire[2]), Number(wire[3] ?? 0), Number(wire[4] ?? 0))
  const legacy = claudeLegacy.exec(slug) ?? claudeLegacy.exec(model.label)
  if (legacy)
    return claudeRank(legacy[3], Number(legacy[1]), Number(legacy[2] ?? 0), Number(legacy[4] ?? 0))
  const named = claudeLabel.exec(model.label)
  if (named) return claudeRank(named[1], Number(named[2]), Number(named[3] ?? 0), 0)
  return undefined
}

function openAIAdvancement(suffix: string | undefined): number {
  if (!suffix) return 40
  const parts = suffix.toLowerCase().split('-')
  if (parts.includes('pro')) return 50
  if (parts.includes('max')) return 45
  if (parts.includes('mini')) return 20
  if (parts.includes('nano')) return 10
  if (parts.includes('codex')) return 35
  return 30
}

function parseOpenAI(model: AgentModel): Rank | undefined {
  const slug = modelSlug(model.id)
  const gpt = gptWire.exec(slug)
  if (gpt) return rank(Number(gpt[1]), Number(gpt[2] ?? 0), 0, openAIAdvancement(gpt[3]))
  const series = oSeriesWire.exec(slug)
  if (series) return rank(Number(series[1]), 0, 0, openAIAdvancement(series[2]))
  const named = gptLabel.exec(model.label)
  if (named) return rank(Number(named[1]), Number(named[2] ?? 0), 0, openAIAdvancement(named[3]))
  return undefined
}

function geminiAdvancement(tier: string): number {
  const name = tier.toLowerCase()
  if (name.startsWith('ultra')) return 50
  if (name.startsWith('pro')) return 40
  if (name.startsWith('flash-lite')) return 10
  if (name.startsWith('flash')) return 20
  return 30
}

function parseGemini(model: AgentModel): Rank | undefined {
  const slug = modelSlug(model.id)
  const wire = geminiWire.exec(slug) ?? geminiWire.exec(model.label)
  if (!wire) return undefined
  return rank(Number(wire[1]), Number(wire[2] ?? 0), 0, geminiAdvancement(wire[3]))
}

function parseGeneric(model: AgentModel): Rank | undefined {
  const stripped = modelSlug(model.id)
    .replace(/\d+\s*[bB]\b/g, ' ')
    .replace(/\d+[xX]\d+/g, ' ')
    .replace(/\d{4,}/g, ' ')
  const match = /(?:^|[^0-9])(\d{1,2})(?:\.(\d{1,2}))?(?!\d)/.exec(stripped)
  if (!match) return undefined
  return rank(Number(match[1]), Number(match[2] ?? 0), 0, 0)
}

function scheme(model: AgentModel): 'claude' | 'openai' | 'gemini' | 'generic' {
  if (model.harness === 'claude') return 'claude'
  if (model.harness === 'codex') return 'openai'
  const slug = modelSlug(model.id)
  const provider = model.provider.toLowerCase()
  if (/anthropic|claude/.test(provider) || /claude-/i.test(slug)) return 'claude'
  if (/openai|codex/.test(provider) || /^(gpt-|o\d)/i.test(slug)) return 'openai'
  if (/google|gemini/.test(provider) || /^gemini-/i.test(slug)) return 'gemini'
  return 'generic'
}

function rankOf(model: AgentModel): Rank {
  const parsed =
    scheme(model) === 'claude'
      ? parseClaude(model)
      : scheme(model) === 'openai'
        ? parseOpenAI(model)
        : scheme(model) === 'gemini'
          ? parseGemini(model)
          : parseGeneric(model)
  return adjust(model, parsed) ?? unranked
}

function compareRank(a: Rank, b: Rank): number {
  if (a.ranked !== b.ranked) return a.ranked ? -1 : 1
  if (!a.ranked) return 0
  if (a.major !== b.major) return b.major - a.major
  if (a.minor !== b.minor) return b.minor - a.minor
  if (a.date !== 0 && b.date !== 0 && a.date !== b.date) return b.date - a.date
  return b.advancement - a.advancement
}

/** Newest version first. Same version: most advanced model first. Order is stable when ranks tie. */
export function sortAgentModels(models: readonly AgentModel[]): AgentModel[] {
  const groups = new Map<string, Array<{ model: AgentModel; index: number }>>()
  const order: string[] = []
  models.forEach((model, index) => {
    const key = `${model.harness}\0${model.provider}`
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)?.push({ model, index })
  })
  return order.flatMap((key) =>
    (groups.get(key) ?? [])
      .sort((a, b) => compareRank(rankOf(a.model), rankOf(b.model)) || a.index - b.index)
      .map((entry) => entry.model)
  )
}
