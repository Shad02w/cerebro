import {
  skillPromptText,
  type AgentDelta,
  type ChatItem,
  type ChatSkillMention
} from '@cerebro/core'
import { randomUUID } from 'node:crypto'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { shellEnv } from '../../shell-env'
import { executable, describe, type Frame } from '../transport'
import type { AgentAdapter, AutonomousTurn, RunAttachment } from './adapter'
import { activeTurn, inline, item, model } from './shared'
import { ClaudeTodoList } from '../todo'
import { claudeSkills } from '../skills'

const promptText = (text: string, skills?: ChatSkillMention[]): string =>
  skillPromptText(text, skills ?? [])

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
/**
 * Build a picker title that keeps the model name visible across Claude Code catalog shapes.
 * Newer builds put capability blurbs first in `description`; older ones put "Opus 5.5" first.
 */
export const claudeModelLabel = (entry: {
  value?: string
  displayName: string
  description?: string
  resolvedModel?: string
}): string => {
  const tip = entry.description?.split(' · ')[0]?.trim()
  if (tip && tip.length <= 48 && claudeVersionedName.test(tip) && !claudeCapabilityBlurb.test(tip))
    return tip
  const wire = entry.resolvedModel || entry.value
  if (/^Default\b/i.test(entry.displayName) && wire) return `${entry.displayName} · ${wire}`
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
const userMessage = (text: string, attachments: RunAttachment[]): SDKUserMessage =>
  ({
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: attachments.length
        ? [
            { type: 'text', text },
            ...attachments.map((attachment) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: attachment.mimeType,
                data: inline(attachment)
              }
            }))
          ]
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

export const claudeAdapter: AgentAdapter = {
  async skills(cwd) {
    return claudeSkills(cwd)
  },
  async models(cwd) {
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
      const entries = await q.supportedModels()
      return entries.map((entry) =>
        model(
          'claude',
          'configured',
          entry.value,
          claudeModelLabel(entry),
          entry.supportedEffortLevels ?? []
        )
      )
    } finally {
      clearTimeout(timeout)
      release()
      q.close()
    }
  },
  connect(session, host) {
    const prompt = new PushableQueue<SDKUserMessage>()
    let q: Query | undefined
    let closed = false
    let current: AutonomousTurn | undefined
    let chainUuid: string | undefined
    // Settings the process runs with now. Model and effort change live; access mode is fixed per process.
    const applied = { model: session.model.id, effort: session.reasoning }
    // Running background tasks by id. Foreground tasks also get notifications and are never listed.
    const background = new Map<string, ReturnType<typeof setTimeout> | undefined>()
    const finish = (error?: Error): void => {
      const turn = current
      current = undefined
      turn?.settle(error)
    }
    const close = (): void => {
      if (closed) return
      closed = true
      for (const timer of background.values()) clearTimeout(timer)
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
    const handle = async (frame: Frame): Promise<void> => {
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
        for (const block of results)
          item(turn.context, block.tool_use_id, 'tool', describe(block.content), {
            status: block.is_error ? 'failed' : 'completed'
          })
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
          const usage = await q!.getContextUsage({ detail: 'summary' })
          turn.context.emit({
            type: 'usage',
            usage: {
              usedTokens: usage.totalTokens,
              contextWindow: usage.rawMaxTokens,
              percentage: usage.percentage
            }
          })
        } catch {
          // Best-effort control-plane call; a turn's success does not depend on it.
        }
        if (current === turn) finish()
      } else if (frame.type === 'system' && frame.subtype === 'background_tasks_changed') {
        // The full live set, which can precede or follow the task_notification that says how a task
        // ended. Ambient watchers are housekeeping, not activity.
        const live = new Set<string>()
        for (const task of Array.isArray(frame.tasks) ? (frame.tasks as Frame[]) : []) {
          if (task.ambient) continue
          const id = String(task.task_id)
          live.add(id)
          if (background.has(id)) continue
          background.set(id, undefined)
          host.task({ id, title: String(task.description ?? ''), status: 'running' })
        }
        // A task can leave the set without its notification (a missed edge). Do not list it forever.
        for (const [id, timer] of background)
          if (!live.has(id) && !timer)
            background.set(
              id,
              setTimeout(() => {
                if (!background.delete(id)) return
                host.task({ id, status: 'stopped', summary: 'Claude stopped reporting this task.' })
              }, 5000)
            )
      } else if (frame.type === 'system' && frame.subtype === 'task_started') {
        if (frame.is_backgrounded && !frame.ambient && background.has(String(frame.task_id)))
          host.task({
            id: String(frame.task_id),
            status: 'running',
            ...(frame.tool_use_id ? { itemId: String(frame.tool_use_id) } : {})
          })
      } else if (frame.type === 'system' && frame.subtype === 'task_notification') {
        const id = String(frame.task_id)
        if (!background.has(id)) return
        clearTimeout(background.get(id))
        background.delete(id)
        // Claude reports the outcome as a status. The exit code exists only in the summary text.
        const exitCode = /exit code (-?\d+)/.exec(String(frame.summary ?? ''))?.[1]
        host.task({
          id,
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
          resume: session.nativeId,
          settingSources: ['user', 'project', 'local'],
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          includePartialMessages: true,
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
