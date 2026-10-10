import type { ChatItem } from '@cerebro/core'
import { randomUUID } from 'node:crypto'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { executable, describe, type Frame } from '../transport'
import type { AgentAdapter, RunAttachment } from './adapter'
import { inline, item, model } from './shared'

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
/** A long-lived AsyncIterable kept open for a turn's duration, so a steered message can be pushed in mid-turn. */
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
        env: { ...process.env },
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
  async run(context) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const { session, signal, emit, ask } = context
    const abortController = new AbortController()
    const abort = (): void => abortController.abort()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const streams = new Map<
      string,
      {
        messageId: string
        blocks: Map<number, { id: string; kind: ChatItem['kind']; input: string }>
      }
    >()
    // Kept open for the whole turn (never a plain string) so a steered message can be pushed in mid-turn.
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
    const prompt = new PushableQueue<SDKUserMessage>()
    prompt.push(userMessage(context.text, context.attachments ?? []))
    context.registerSteer?.(async (text, attachments) => {
      prompt.push(userMessage(text, attachments))
    })
    const effort = session.reasoning as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined
    const q = query({
      prompt,
      options: {
        cwd: session.cwd,
        pathToClaudeCodeExecutable: executable('claude'),
        env: { ...process.env },
        model: session.model.id || undefined,
        ...(effort ? { effort } : {}),
        resume: session.nativeId,
        abortController,
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
          const answer = await ask({
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
    try {
      let completed = false
      let chainUuid: string | undefined
      for await (const raw of q) {
        const frame = raw as unknown as Frame
        if (frame.session_id && !frame.parent_tool_use_id)
          emit({ type: 'binding', nativeId: frame.session_id })
        if (frame.type === 'stream_event') {
          const e: Frame = frame.event
          const channel = frame.parent_tool_use_id ?? 'root'
          if (e.type === 'message_start')
            streams.set(channel, { messageId: e.message.id, blocks: new Map() })
          const stream = streams.get(channel)
          if (!stream) continue
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
            if (!block) continue
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
          if (!frame.parent_tool_use_id) {
            chainUuid = frame.uuid
            evictSuperseded(frame.supersedes)
          }
          const ids: string[] = []
          for (const block of (frame.message.content ?? []) as Frame[]) {
            const id = claimBlockId(frame.message.id, block)
            ids.push(id)
            if (block.type === 'tool_use')
              item(context, id, 'tool', '', {
                title: block.name,
                input: describe(block.input),
                status: 'running'
              })
            else if (block.type === 'text' || block.type === 'thinking')
              item(
                context,
                id,
                block.type === 'text' ? 'text' : 'reasoning',
                block.text ?? block.thinking ?? '',
                { status: 'completed' }
              )
          }
          if (frame.uuid) idsByMessageUuid.set(frame.uuid, ids)
        } else if (frame.type === 'user') {
          for (const block of Array.isArray(frame.message?.content) ? frame.message.content : [])
            if (block.type === 'tool_result')
              item(context, block.tool_use_id, 'tool', describe(block.content), {
                status: block.is_error ? 'failed' : 'completed'
              })
        } else if (frame.type === 'result') {
          completed = true
          if (frame.is_error || frame.subtype !== 'success')
            throw new Error(describe(frame.errors ?? frame.result ?? frame.subtype))
          if (chainUuid) emit({ type: 'checkpoint', turnId: session.turnId!, chainId: chainUuid })
          try {
            const usage = await q.getContextUsage({ detail: 'summary' })
            emit({
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
          // The prompt queue stays open for steering, so nothing else closes stdin for us — stop explicitly once this turn's result lands.
          break
        } else if (frame.type === 'system' && frame.subtype === 'compact_boundary')
          item(context, randomUUID(), 'notice', 'Native conversation compacted.')
        else if (frame.type === 'system' && frame.subtype === 'model_refusal_fallback')
          evictSuperseded(frame.retracted_message_uuids)
      }
      if (!completed) throw new Error('Claude ended without a turn result.')
    } finally {
      signal.removeEventListener('abort', abort)
      prompt.end()
      q.close()
    }
  }
}
