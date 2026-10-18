import {
  fileExtension,
  skillPromptText,
  textFileExtensions,
  type AgentDelta,
  type AgentSession,
  type AttachmentPolicy,
  type ChatItem,
  type ChatSkillMention
} from '@cerebro/core'
import { randomUUID } from 'node:crypto'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { shellEnv } from '../../shell-env'
import { executable, describe, type Frame } from '../transport'
import type { AgentAdapter, AutonomousTurn, RunAttachment } from './adapter'
import { claudeContextUsage } from '../context-usage'
import { activeTurn, inline, item, model } from './shared'
import { readFileSync } from 'node:fs'
import { ClaudeTodoList } from '../todo'
import { claudeExposedSkills } from '../skills'

const promptText = (text: string, skills?: ChatSkillMention[]): string =>
  skillPromptText(text, skills ?? [])

/** Resume options for one Claude connect. A rewound send forks so Undo can keep the original chain. */
export function claudeResumeOptions(session: Pick<AgentSession, 'nativeId' | 'nativeResume'>): {
  resume?: string
  resumeSessionAt?: string
  forkSession?: true
} {
  const resume = session.nativeResume
  return {
    ...(session.nativeId ? { resume: session.nativeId } : {}),
    ...(resume?.at ? { resumeSessionAt: resume.at } : {}),
    ...(resume?.fork ? { forkSession: true } : {})
  }
}

/** Capability blurbs Claude sometimes puts first in `description` — never use these as titles. */
const claudeCapabilityBlurb =
  /^(best for|efficient for|fastest for|most capable|use the default model)\b/i
/** Family-shaped tip like "Opus 5.5", "Sonnet 5", "Haiku 4.5", "Fable 5.1". */
const claudeVersionedName = /^(Opus|Sonnet|Haiku|Fable|Claude)\b.*\d/i
/** Short version from a wire id: claude-opus-5-5 → 5.5, claude-fable-5-1 → 5.1. */
const shortClaudeVersion = (id?: string): string | undefined => {
  if (!id) return
  const match = id.match(/^claude-(?:opus|sonnet|haiku|fable)-(\d+(?:-\d+)?)(?:-|$|\[)/i)
  return match?.[1]?.replace(/-/g, '.')
}
/** Versioned name at the start of a description, such as "Sonnet 5.5". Blurbs are not titles. */
const versionedTip = (description?: string): string | undefined => {
  const tip = description?.split(' · ')[0]?.trim()
  if (tip && tip.length <= 48 && claudeVersionedName.test(tip) && !claudeCapabilityBlurb.test(tip))
    return tip
}
/**
 * Build a picker title that keeps the model name visible across Claude Code catalog shapes.
 * Newer builds put capability blurbs first in `description`; older ones put "Opus 5.5" first.
 *
 * `default` is not a model. It clears any override and follows the account default, which
 * currently resolves to the same Sonnet 5.5 as the `sonnet` alias. Name that model in the
 * label (`Default · Sonnet 5.5`) so the picker can drop this row when the named model is
 * already listed. A default that points at nothing else stays, still labeled as Default.
 */
export const claudeModelLabel = (entry: {
  value?: string
  displayName: string
  description?: string
  resolvedModel?: string
}): string => {
  const tip = versionedTip(entry.description)
  const wire = entry.resolvedModel || entry.value
  if (entry.value === 'default' || /^default\b/i.test(entry.displayName)) {
    const name = /^default\b/i.test(entry.displayName) ? entry.displayName : 'Default'
    const version = shortClaudeVersion(wire)
    const current =
      tip ??
      (claudeVersionedName.test(entry.displayName) ? entry.displayName : undefined) ??
      (version && entry.displayName && !/^default\b/i.test(entry.displayName)
        ? `${entry.displayName} ${version}`
        : undefined)
    if (current && current !== name) return `${name} · ${current}`
    if (wire && wire !== 'default') return `${name} · ${wire}`
    return name
  }
  if (tip) return tip
  const version = shortClaudeVersion(wire)
  if (
    version &&
    entry.displayName &&
    !/\d/.test(entry.displayName) &&
    !claudeCapabilityBlurb.test(entry.displayName)
  )
    return `${entry.displayName} ${version}`
  if (entry.displayName && !claudeCapabilityBlurb.test(entry.displayName)) return entry.displayName
  return wire || entry.displayName
}
/**
 * Anthropic bounds: images are 5 MB each; PDFs and the whole request share a 32 MB payload, and
 * base64 adds a third, so the raw total stays under 24 MB. PDFs and text go in as native document blocks.
 */
const claudeAttachments: AttachmentPolicy = {
  maxCount: 20,
  maxTotalBytes: 24 * 1024 * 1024,
  image: { maxBytes: 5 * 1024 * 1024, maxEdge: 2000 },
  file: {
    maxBytes: 20 * 1024 * 1024,
    extensions: ['.pdf', ...textFileExtensions],
    description: 'PDF and text or code files'
  }
}
const attachmentBlock = (attachment: RunAttachment) => {
  if (attachment.kind === 'image')
    return {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: attachment.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: inline(attachment)
      }
    }
  if (fileExtension(attachment.name) === '.pdf')
    return {
      type: 'document' as const,
      title: attachment.name,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: inline(attachment)
      }
    }
  return {
    type: 'document' as const,
    title: attachment.name,
    source: {
      type: 'text' as const,
      media_type: 'text/plain' as const,
      data: readFileSync(attachment.path, 'utf8')
    }
  }
}
const userMessage = (text: string, attachments: RunAttachment[]): SDKUserMessage =>
  ({
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: attachments.length
        ? [{ type: 'text', text }, ...attachments.map(attachmentBlock)]
        : text
    }
  }) satisfies SDKUserMessage
/** The prompt stream of a session's Claude process. Turns and steered messages are pushed for its whole life. */
class PushableQueue<T> implements AsyncIterable<T> {
  private buffered: T[] = []
  private waiting: Array<(result: IteratorResult<T>) => void> = []
  private ended = false
  push(value: T): void {
    if (this.ended) throw new Error('Turn already ending; message was not delivered.')
    const waiter = this.waiting.shift()
    if (waiter) waiter({ value, done: false })
    else this.buffered.push(value)
  }
  end(): void {
    this.ended = true
    for (const waiter of this.waiting.splice(0)) waiter({ value: undefined, done: true })
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffered.length)
          return Promise.resolve({ value: this.buffered.shift()!, done: false })
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.waiting.push(resolve))
      }
    }
  }
}

/**
 * Opens a Claude Code process with the same settings sources as a chat, reads one answer, and closes it.
 * Skill listing uses this so the menu is the set Claude itself exposes, including enabled plugin skills.
 */
const askClaude = async <T>(cwd: string, read: (query: Query) => Promise<T>): Promise<T> => {
  const binary = executable('claude')
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  let release: () => void = () => {}
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  const prompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await wait
        return { done: true, value: undefined }
      }
    })
  }
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 15_000)
  const q = query({
    prompt,
    options: {
      abortController,
      cwd,
      pathToClaudeCodeExecutable: binary,
      env: { ...shellEnv() },
      settingSources: ['user', 'project', 'local']
    }
  })
  try {
    return await read(q)
  } finally {
    clearTimeout(timeout)
    release()
    q.close()
  }
}

export const claudeAdapter: AgentAdapter = {
  attachments: claudeAttachments,
  async skills(cwd) {
    const listed = await askClaude(cwd, (q) => q.reloadSkills())
    return claudeExposedSkills(listed.skills ?? [])
  },
  async models(cwd) {
    const entries = await askClaude(cwd, (q) => q.supportedModels())
    return entries.map((entry) =>
      model(
        'claude',
        'configured',
        entry.value,
        claudeModelLabel(entry),
        entry.supportedEffortLevels ?? []
      )
    )
  },
  connect(session, host) {
    const prompt = new PushableQueue<SDKUserMessage>()
    let q: Query | undefined
    let closed = false
    let current: AutonomousTurn | undefined
    let chainUuid: string | undefined
    // Settings the process runs with now. Model and effort change live; access mode is fixed per process.
    const applied = { model: session.model.id, effort: session.reasoning }
    // Running shell jobs by id. Foreground tasks also get notifications and are never listed.
    // Agent tasks (local_agent, remote_agent) are not stored here.
    const background = new Map<string, ReturnType<typeof setTimeout> | undefined>()
    // Agent task ids currently in the live set, and the timer that settles one that disappeared.
    const listedAgents = new Set<string>()
    const agentTimers = new Map<string, ReturnType<typeof setTimeout> | undefined>()
    const finish = (error?: Error): void => {
      const turn = current
      current = undefined
      turn?.settle(error)
    }
    const close = (): void => {
      if (closed) return
      closed = true
      for (const timer of background.values()) clearTimeout(timer)
      for (const timer of agentTimers.values()) clearTimeout(timer)
      prompt.end()
      q?.close()
      finish(new Error('Agent stopped.'))
    }
    const native = {
      interrupt: (): void => void q?.interrupt().catch(() => {}),
      close
    }
    const adopt = (context: AutonomousTurn['context'], settle: AutonomousTurn['settle']): void => {
      current = activeTurn(context, settle, native)
      chainUuid = undefined
    }
    /** The turn to stream into. Output while idle is Claude following up on a settled background task. */
    const turnFor = (): AutonomousTurn | undefined => {
      if (current || closed) return current
      const turn = host.autonomous()
      if (turn) adopt(turn.context, turn.settle)
      return current
    }
    const emit = (event: AgentDelta): void =>
      current ? current.context.emit(event) : host.idle(event)
    const effort = session.reasoning as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined
    const todos = new ClaudeTodoList(session.id, session.todo?.items)
    const streams = new Map<
      string,
      {
        messageId: string
        blocks: Map<number, { id: string; kind: ChatItem['kind']; input: string }>
      }
    >()
    // Ids emitted for each top-level assistant message, keyed by its own uuid — a refusal-fallback
    // retry names the uuids it supersedes, and the client is responsible for evicting their items.
    const idsByMessageUuid = new Map<string, string[]>()
    // Text and thinking blocks have no native id. The stream names them `${messageId}:${index}`, but a
    // completed `assistant` frame carries only its own block, so it can't recompute that index. Streamed
    // blocks wait here, per message, until the matching completed frame claims them.
    const unclaimed = new Map<string, Array<{ id: string; kind: ChatItem['kind'] }>>()
    const seen = new Map<string, number>()
    const blockKind = (type: string): ChatItem['kind'] =>
      type === 'tool_use' ? 'tool' : type === 'thinking' ? 'reasoning' : 'text'
    const claimBlockId = (messageId: string, block: Frame): string => {
      const kind = blockKind(block.type)
      const position = seen.get(messageId) ?? 0
      seen.set(messageId, position + 1)
      const queue = unclaimed.get(messageId) ?? []
      const at = queue.findIndex((slot) =>
        kind === 'tool' ? slot.id === block.id : slot.kind === kind
      )
      if (at !== -1) return queue.splice(at, 1)[0].id
      // Never streamed (resumed or non-partial output): the position in the message is the index.
      return block.id ?? `${messageId}:${position}`
    }
    const evictSuperseded = (uuids: string[] | undefined): void => {
      const ids = (uuids ?? []).flatMap((uuid) => idsByMessageUuid.get(uuid) ?? [])
      if (ids.length) emit({ type: 'evict', ids })
    }
    // Tool titles, keyed by tool-use id, so a child frame can be named after the tool that spawned it.
    const toolTitles = new Map<string, string>()
    const toolIdentity = new Map<string, { model?: string; effort?: string }>()
    // Child ids already reported, and the title last sent for each.
    const children = new Map<string, string | undefined>()
    const settled = new Set<string>()
    // tool-use id and task id both point at the one sub-agent id already reported.
    const alias = new Map<string, string>()
    const agentIds = new Set<string>()
    // A tool_result for one of these is the launch acknowledgement, not the agent's end.
    const backgrounded = new Set<string>()
    const toolBackground = new Set<string>()
    const markBackground = (id: string): void => {
      backgrounded.add(id)
      const linked = alias.get(id)
      if (linked) backgrounded.add(linked)
    }
    const isAgentTask = (taskType: unknown): boolean =>
      taskType === 'local_agent' || taskType === 'remote_agent'
    const linkChild = (taskId: string, toolUseId?: unknown): string => {
      const tool = toolUseId == null || toolUseId === '' ? undefined : String(toolUseId)
      const known =
        alias.get(taskId) ||
        (tool ? alias.get(tool) : undefined) ||
        (tool && children.has(tool) ? tool : undefined) ||
        (children.has(taskId) ? taskId : undefined) ||
        taskId
      alias.set(taskId, known)
      agentIds.add(taskId)
      agentIds.add(known)
      if (tool) {
        alias.set(tool, known)
        agentIds.add(tool)
      }
      return known
    }
    const taskUsage = (usage: unknown): { total?: number; durationMs?: number } | undefined => {
      if (!usage || typeof usage !== 'object') return undefined
      const record = usage as Frame
      const total = typeof record.total_tokens === 'number' ? record.total_tokens : undefined
      const durationMs = typeof record.duration_ms === 'number' ? record.duration_ms : undefined
      if (total === undefined && durationMs === undefined) return undefined
      return {
        ...(total !== undefined ? { total } : {}),
        ...(durationMs !== undefined ? { durationMs } : {})
      }
    }
    const textField = (value: unknown): string | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      if (typeof value !== 'string') return undefined
      const trimmed = value.trim()
      return trimmed ? trimmed : undefined
    }
    // Model and effort are copied only from the object that names this child.
    const childIdentity = (source: Frame | undefined): { model?: string; effort?: string } => {
      if (!source) return {}
      const model = textField(source.model)
      const effort = textField(source.effort ?? source.effort_level ?? source.effortLevel)
      return {
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {})
      }
    }
    const isAgentTool = (name: unknown): boolean => name === 'Task' || name === 'Agent'
    const titleFrom = (name: unknown, input: unknown): string | undefined => {
      let parsed = input
      if (typeof input === 'string' && input.trim().startsWith('{')) {
        try {
          parsed = JSON.parse(input)
        } catch {
          parsed = undefined
        }
      }
      const description =
        parsed && typeof parsed === 'object' && typeof (parsed as Frame).description === 'string'
          ? String((parsed as Frame).description).trim()
          : ''
      if (description) return description
      return typeof name === 'string' && name ? name : undefined
    }
    const rememberTool = (id: unknown, name: unknown, input: unknown): void => {
      if (id == null || id === '') return
      const key = String(id)
      const title = titleFrom(name, input)
      if (isAgentTool(name)) {
        let parsed = input
        if (typeof input === 'string' && input.trim().startsWith('{')) {
          try {
            parsed = JSON.parse(input)
          } catch {
            parsed = undefined
          }
        }
        const record = parsed && typeof parsed === 'object' ? (parsed as Frame) : undefined
        const identity = childIdentity(record)
        if (identity.model || identity.effort) toolIdentity.set(key, identity)
        if (record?.run_in_background === true || record?.isolation === 'remote')
          toolBackground.add(key)
      }
      if (!title || toolTitles.get(key) === title) return
      toolTitles.set(key, title)
      if (!children.has(key) || children.get(key) === title) return
      children.set(key, title)
      host.subagent({ id: key, status: 'running', title, ...toolIdentity.get(key) })
    }
    const noteChild = (parentId: unknown): void => {
      if (parentId == null || parentId === '') return
      const raw = String(parentId)
      const id = alias.get(raw) ?? raw
      const title = toolTitles.get(raw) ?? toolTitles.get(id)
      const identity = toolIdentity.get(raw) ?? toolIdentity.get(id)
      if (!children.has(id)) {
        children.set(id, title)
        host.subagent({
          id,
          status: 'running',
          ...(title ? { title } : {}),
          ...identity
        })
        return
      }
      if (title && children.get(id) !== title) {
        children.set(id, title)
        host.subagent({ id, status: 'running', title, ...identity })
      }
    }
    const childTokens = (
      usage: unknown
    ): { input?: number; output?: number; total?: number } | undefined => {
      if (!usage || typeof usage !== 'object') return undefined
      const record = usage as Frame
      const input = typeof record.input_tokens === 'number' ? record.input_tokens : undefined
      const output = typeof record.output_tokens === 'number' ? record.output_tokens : undefined
      const total = typeof record.total_tokens === 'number' ? record.total_tokens : undefined
      if (input === undefined && output === undefined && total === undefined) return undefined
      return {
        ...(input !== undefined ? { input } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(total !== undefined ? { total } : {})
      }
    }
    const finishChild = (block: Frame, toolUseResult: unknown): void => {
      if (block.tool_use_id == null) return
      const raw = String(block.tool_use_id)
      const id = alias.get(raw) ?? raw
      if (!children.has(id)) return
      const result =
        toolUseResult && typeof toolUseResult === 'object' ? (toolUseResult as Frame) : undefined
      const resultStatus = typeof result?.status === 'string' ? result.status : undefined
      const durationMs =
        typeof result?.totalDurationMs === 'number' ? result.totalDurationMs : undefined
      const launched =
        result?.detachedToolCall === true ||
        resultStatus === 'async_launched' ||
        resultStatus === 'remote_launched' ||
        /running in the background/i.test(describe(block.content))
      const stillRunning =
        resultStatus !== 'completed' &&
        (launched ||
          backgrounded.has(id) ||
          backgrounded.has(raw) ||
          toolBackground.has(raw) ||
          toolBackground.has(id))
      if (stillRunning || durationMs === 0) {
        const launchedId = textField(result?.agentId) ?? textField(result?.taskId)
        if (launchedId) markBackground(linkChild(launchedId, raw))
        else markBackground(id)
        return
      }
      settled.add(id)
      const tokens =
        childTokens(block.usage) ??
        (typeof result?.totalTokens === 'number' ? { total: result.totalTokens } : undefined)
      const finishedAt = Date.now()
      host.subagent({
        id,
        status: block.is_error ? 'failed' : 'completed',
        ...(tokens ? { tokens } : {}),
        ...(durationMs !== undefined
          ? { durationMs, startedAt: finishedAt - durationMs, finishedAt }
          : {}),
        ...childIdentity(result),
        announce: true
      })
    }
    const reportAgent = (
      id: string,
      update: {
        status: 'running' | 'completed' | 'failed' | 'stopped'
        title?: string
        summary?: string
        tokens?: { total: number }
        startedAt?: number
        finishedAt?: number
        durationMs?: number
        model?: string
        effort?: string
        announce?: boolean
      }
    ): void => {
      // A later live-set frame must not reopen an agent that already ended.
      if (update.status === 'running' && settled.has(id)) return
      if (!children.has(id) || (update.title && children.get(id) !== update.title))
        children.set(id, update.title ?? children.get(id))
      if (update.status !== 'running') settled.add(id)
      host.subagent({
        id,
        status: update.status,
        ...(update.title ? { title: update.title } : {}),
        ...(update.summary ? { summary: update.summary } : {}),
        ...(update.tokens ? { tokens: update.tokens } : {}),
        ...(update.startedAt !== undefined ? { startedAt: update.startedAt } : {}),
        ...(update.finishedAt !== undefined ? { finishedAt: update.finishedAt } : {}),
        ...(update.durationMs !== undefined ? { durationMs: update.durationMs } : {}),
        ...(update.model ? { model: update.model } : {}),
        ...(update.effort ? { effort: update.effort } : {}),
        ...(update.announce ? { announce: true } : {})
      })
    }
    const handle = async (frame: Frame): Promise<void> => {
      // Child frames share the parent stream. They are status, not transcript rows.
      if (frame.parent_tool_use_id && frame.type !== 'result') {
        noteChild(frame.parent_tool_use_id)
        const childId =
          alias.get(String(frame.parent_tool_use_id)) ?? String(frame.parent_tool_use_id)
        const message =
          frame.message && typeof frame.message === 'object' ? frame.message : undefined
        const identity = childIdentity({
          model: frame.model ?? message?.model,
          effort: frame.effort ?? frame.effort_level ?? message?.effort
        })
        if ((identity.model || identity.effort) && !settled.has(childId))
          host.subagent({ id: childId, status: 'running', ...identity })
        if (frame.type === 'user') {
          const blocks = Array.isArray(frame.message?.content) ? frame.message.content : []
          for (const block of blocks as Frame[])
            if (block.type === 'tool_result') finishChild(block, frame.tool_use_result)
        }
        return
      }
      if (frame.session_id && !frame.parent_tool_use_id)
        emit({ type: 'binding', nativeId: frame.session_id })
      if (frame.type === 'stream_event') {
        const turn = turnFor()
        if (!turn) return
        const context = turn.context
        const e: Frame = frame.event
        const channel = frame.parent_tool_use_id ?? 'root'
        if (e.type === 'message_start')
          streams.set(channel, { messageId: e.message.id, blocks: new Map() })
        const stream = streams.get(channel)
        if (!stream) return
        const { messageId, blocks } = stream
        if (e.type === 'content_block_start') {
          const block = e.content_block
          const kind = blockKind(block.type)
          const id = block.id ?? `${messageId}:${e.index}`
          blocks.set(e.index, { id, kind, input: '' })
          if (kind === 'tool') rememberTool(block.id, block.name, block.input)
          unclaimed.set(messageId, [...(unclaimed.get(messageId) ?? []), { id, kind }])
          item(context, id, kind, block.text ?? block.thinking ?? '', {
            title: block.name,
            status: 'running',
            ...(kind === 'tool' ? { input: describe(block.input) } : {})
          })
        }
        if (e.type === 'content_block_delta') {
          const block = blocks.get(e.index)
          if (!block) return
          if (e.delta.type === 'input_json_delta') {
            block.input += e.delta.partial_json
            item(context, block.id, block.kind, '', { input: block.input })
          } else if (e.delta.type === 'text_delta' || e.delta.type === 'thinking_delta')
            item(context, block.id, block.kind, e.delta.text ?? e.delta.thinking ?? '', {}, true)
        }
        if (e.type === 'content_block_stop') {
          const block = blocks.get(e.index)
          // A tool block closing only means its input is complete; the tool_result settles it.
          if (block && block.kind !== 'tool')
            item(context, block.id, block.kind, '', { status: 'completed' }, true)
        }
      } else if (frame.type === 'assistant') {
        const turn = turnFor()
        if (!turn) return
        if (!frame.parent_tool_use_id) {
          chainUuid = frame.uuid
          evictSuperseded(frame.supersedes)
        }
        const ids: string[] = []
        for (const block of (frame.message.content ?? []) as Frame[]) {
          const id = claimBlockId(frame.message.id, block)
          ids.push(id)
          if (block.type === 'tool_use') {
            rememberTool(block.id ?? id, block.name, block.input)
            item(turn.context, id, 'tool', '', {
              title: block.name,
              input: describe(block.input),
              status: 'running'
            })
            const snapshot = todos.input(
              String(block.id ?? id),
              String(block.name ?? ''),
              block.input
            )
            if (snapshot) emit({ type: 'todo', todo: snapshot })
          } else if (block.type === 'text' || block.type === 'thinking')
            item(
              turn.context,
              id,
              block.type === 'text' ? 'text' : 'reasoning',
              block.text ?? block.thinking ?? '',
              { status: 'completed' }
            )
        }
        if (frame.uuid) idsByMessageUuid.set(frame.uuid, ids)
      } else if (frame.type === 'user') {
        const blocks = Array.isArray(frame.message?.content) ? frame.message.content : []
        if (!blocks.some((block: Frame) => block.type === 'tool_result')) return
        const turn = turnFor()
        if (!turn) return
        const results = blocks.filter((block: Frame) => block.type === 'tool_result')
        for (const block of results) {
          item(turn.context, block.tool_use_id, 'tool', describe(block.content), {
            status: block.is_error ? 'failed' : 'completed'
          })
          finishChild(block, results.length === 1 ? frame.tool_use_result : undefined)
        }
        // The assigned task id lives on tool_use_result, not in the tool input.
        const known = results.filter((block: Frame) => todos.known(String(block.tool_use_id)))
        const target =
          known.length === 1
            ? known[0]
            : known.length === 0 && results.length === 1
              ? results[0]
              : undefined
        if (target && frame.tool_use_result != null) {
          const snapshot = todos.result(String(target.tool_use_id), frame.tool_use_result)
          if (snapshot) emit({ type: 'todo', todo: snapshot })
        }
      } else if (frame.type === 'result') {
        if (frame.parent_tool_use_id) return
        const turn = current
        if (!turn) return
        if (frame.is_error || frame.subtype !== 'success') {
          finish(new Error(describe(frame.errors ?? frame.result ?? frame.subtype)))
          return
        }
        if (chainUuid)
          turn.context.emit({
            type: 'checkpoint',
            turnId: turn.context.session.turnId!,
            chainId: chainUuid
          })
        try {
          const usage = claudeContextUsage(await q!.getContextUsage({ detail: 'summary' }))
          if (usage) turn.context.emit({ type: 'usage', usage })
        } catch {
          // Best-effort control-plane call; a turn's success does not depend on it.
        }
        if (current === turn) finish()
      } else if (frame.type === 'system' && frame.subtype === 'background_tasks_changed') {
        // The full live set, which can precede or follow the task_notification that says how a task
        // ended. Ambient watchers are housekeeping, not activity. Shell jobs stay background
        // tasks. local_agent and remote_agent are sub-agents and never enter that list.
        const liveShells = new Set<string>()
        const liveAgents = new Set<string>()
        for (const task of Array.isArray(frame.tasks) ? (frame.tasks as Frame[]) : []) {
          if (task.ambient) continue
          const taskId = String(task.task_id)
          const title = String(task.description ?? '')
          if (isAgentTask(task.task_type)) {
            const id = linkChild(taskId, task.tool_use_id)
            markBackground(id)
            liveAgents.add(id)
            reportAgent(id, {
              status: 'running',
              ...(title ? { title } : {}),
              ...childIdentity(task)
            })
            continue
          }
          liveShells.add(taskId)
          if (background.has(taskId)) continue
          background.set(taskId, undefined)
          host.task({ id: taskId, title, status: 'running' })
        }
        // A shell can leave the set without its notification (a missed edge). Do not list it forever.
        for (const [id, timer] of background)
          if (!liveShells.has(id) && !timer)
            background.set(
              id,
              setTimeout(() => {
                if (!background.delete(id)) return
                host.task({ id, status: 'stopped', summary: 'Claude stopped reporting this task.' })
              }, 5000)
            )
        for (const id of listedAgents)
          if (!liveAgents.has(id) && !agentTimers.has(id))
            agentTimers.set(
              id,
              setTimeout(() => {
                if (!agentTimers.delete(id)) return
                listedAgents.delete(id)
                reportAgent(id, {
                  status: 'stopped',
                  summary: 'Claude stopped reporting this agent.'
                })
              }, 5000)
            )
        for (const id of liveAgents) {
          const timer = agentTimers.get(id)
          if (timer) {
            clearTimeout(timer)
            agentTimers.delete(id)
          }
          listedAgents.add(id)
        }
      } else if (frame.type === 'system' && frame.subtype === 'task_started') {
        if (frame.ambient) return
        if (isAgentTask(frame.task_type)) {
          const id = linkChild(String(frame.task_id), frame.tool_use_id)
          if (frame.is_backgrounded) markBackground(id)
          const title = String(frame.description ?? '')
          reportAgent(id, {
            status: 'running',
            ...(title ? { title } : {}),
            ...childIdentity(frame)
          })
          return
        }
        if (frame.is_backgrounded && background.has(String(frame.task_id)))
          host.task({
            id: String(frame.task_id),
            status: 'running',
            ...(frame.tool_use_id ? { itemId: String(frame.tool_use_id) } : {})
          })
      } else if (frame.type === 'system' && frame.subtype === 'task_progress') {
        const taskId = String(frame.task_id)
        if (!agentIds.has(taskId) && !frame.subagent_type && !isAgentTask(frame.task_type)) return
        const id = linkChild(taskId, frame.tool_use_id)
        const usage = taskUsage(frame.usage)
        const title = String(frame.description ?? '')
        reportAgent(id, {
          status: 'running',
          ...(title ? { title } : {}),
          ...(frame.summary ? { summary: String(frame.summary) } : {}),
          ...(usage?.total !== undefined ? { tokens: { total: usage.total } } : {}),
          // duration_ms is the elapsed time to show. The corrected start is kept so a later
          // finish without a duration still measures from the harness clock, not the local guess.
          ...(usage?.durationMs
            ? { durationMs: usage.durationMs, startedAt: Date.now() - usage.durationMs }
            : {}),
          ...childIdentity(frame)
        })
      } else if (frame.type === 'system' && frame.subtype === 'task_notification') {
        const taskId = String(frame.task_id)
        const agent =
          agentIds.has(taskId) || Boolean(frame.subagent_type) || isAgentTask(frame.task_type)
        if (agent) {
          const id = linkChild(taskId, frame.tool_use_id)
          const usage = taskUsage(frame.usage)
          const title = String(frame.description ?? '')
          const terminal =
            frame.status === 'completed' || frame.status === 'failed' || frame.status === 'stopped'
          if (!terminal || usage?.durationMs === 0) {
            reportAgent(id, {
              status: 'running',
              ...(title ? { title } : {}),
              ...childIdentity(frame)
            })
            return
          }
          const timer = agentTimers.get(id)
          if (timer) clearTimeout(timer)
          agentTimers.delete(id)
          listedAgents.delete(id)
          const finishedAt = Date.now()
          // The summary and the child's response stay off the transcript.
          reportAgent(id, {
            status:
              frame.status === 'failed'
                ? 'failed'
                : frame.status === 'stopped'
                  ? 'stopped'
                  : 'completed',
            ...(title ? { title } : {}),
            ...(frame.summary ? { summary: String(frame.summary) } : {}),
            ...(usage?.total !== undefined ? { tokens: { total: usage.total } } : {}),
            ...(usage?.durationMs !== undefined
              ? {
                  durationMs: usage.durationMs,
                  startedAt: finishedAt - usage.durationMs,
                  finishedAt
                }
              : { finishedAt }),
            ...childIdentity(frame),
            announce: true
          })
          return
        }
        if (!background.has(taskId)) return
        clearTimeout(background.get(taskId))
        background.delete(taskId)
        // Claude reports the outcome as a status. The exit code exists only in the summary text.
        const exitCode = /exit code (-?\d+)/.exec(String(frame.summary ?? ''))?.[1]
        host.task({
          id: taskId,
          status:
            frame.status === 'failed'
              ? 'failed'
              : frame.status === 'stopped'
                ? 'stopped'
                : 'completed',
          ...(frame.summary ? { summary: String(frame.summary) } : {}),
          ...(exitCode !== undefined ? { exitCode: Number(exitCode) } : {}),
          endedAt: Date.now()
        })
      } else if (frame.type === 'system' && frame.subtype === 'compact_boundary') {
        if (current) item(current.context, randomUUID(), 'notice', 'Native conversation compacted.')
      } else if (frame.type === 'system' && frame.subtype === 'model_refusal_fallback')
        evictSuperseded(frame.retracted_message_uuids)
    }
    const read = async (query: Query): Promise<void> => {
      let error = new Error('Claude exited.')
      try {
        for await (const raw of query) await handle(raw as unknown as Frame)
      } catch (cause) {
        error = cause instanceof Error ? cause : new Error(String(cause))
      }
      if (closed) return
      closed = true
      prompt.end()
      finish(error)
      host.exited(error)
    }
    const ready = (async () => {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      if (closed) return
      q = query({
        prompt,
        options: {
          cwd: session.cwd,
          pathToClaudeCodeExecutable: executable('claude'),
          // Models Claude Code does not recognize omit Task tools unless the session opts in.
          env: { ...shellEnv(), CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
          model: session.model.id || undefined,
          ...(effort ? { effort } : {}),
          ...claudeResumeOptions(session),
          settingSources: ['user', 'project', 'local'],
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          includePartialMessages: true,
          // forwardSubagentText stays at the SDK default (false): child text and thinking
          // are not requested. Frames that still arrive with parent_tool_use_id are dropped.
          permissionMode:
            session.accessMode === 'read'
              ? 'plan'
              : session.accessMode === 'edit'
                ? 'acceptEdits'
                : 'bypassPermissions',
          allowDangerouslySkipPermissions: !session.accessMode || session.accessMode === 'full',
          canUseTool: async (name, input, options) => {
            const questions =
              name === 'AskUserQuestion' && Array.isArray(input.questions)
                ? (input.questions as Frame[]).map((question, index) => ({
                    id: String(index),
                    label: question.question,
                    options: question.options?.map((o: Frame) => o.label),
                    multiple: Boolean(question.multiSelect)
                  }))
                : undefined
            if (!questions && session.accessMode === 'read')
              return { behavior: 'deny', message: 'Read-only mode does not allow this operation.' }
            if (!questions && (!session.accessMode || session.accessMode === 'full'))
              return { behavior: 'allow', updatedInput: input }
            const turn = current
            if (!turn) return { behavior: 'deny', message: 'No Cerebro turn is waiting on this.' }
            const answer = await turn.context.ask({
              id: options.toolUseID,
              kind: questions ? 'question' : 'approval',
              title: name,
              text: questions ? '' : describe(input),
              questions
            })
            if (!answer.allow) return { behavior: 'deny', message: 'Declined in Cerebro.' }
            return {
              behavior: 'allow',
              updatedInput: questions
                ? {
                    ...input,
                    answers: Object.fromEntries(
                      questions.map((q) => [q.label, (answer.answers[q.id] ?? []).join(', ')])
                    )
                  }
                : input
            }
          }
        }
      })
      void read(q)
    })()
    void ready.catch(() => {})
    return {
      async run(context) {
        if (closed) throw new Error('Claude process is closed.')
        if (current) throw new Error('Claude is already running a turn.')
        if (context.signal.aborted) throw new Error('Turn interrupted.')
        const done = new Promise<void>((resolve, reject) =>
          // Claimed before any await: output racing the prompt belongs to this turn, not a new one.
          adopt(context, (error) => (error ? reject(error) : resolve()))
        )
        const turn = current
        try {
          await ready
          if (!q || closed) throw new Error('Claude process is closed.')
          if (context.session.model.id !== applied.model) {
            await q.setModel(context.session.model.id || undefined)
            applied.model = context.session.model.id
          }
          if (context.session.reasoning !== applied.effort) {
            await q.applyFlagSettings({
              effortLevel: (context.session.reasoning ?? null) as 'low' | null
            })
            applied.effort = context.session.reasoning
          }
          if (current !== turn) return await done
          context.registerSteer?.(async (text, attachments, skills) => {
            prompt.push(userMessage(promptText(text, skills), attachments))
          })
          prompt.push(
            userMessage(promptText(context.text, context.skills), context.attachments ?? [])
          )
        } catch (error) {
          if (current === turn) finish(error instanceof Error ? error : new Error(String(error)))
        }
        return done
      },
      close
    }
  }
}
