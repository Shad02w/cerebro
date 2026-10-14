import type { AgentHarness, AgentModel } from '@cerebro/core'
import { homedir } from 'node:os'
import { shellEnv } from '../shell-env'
import { codexAppServer } from './codex-server'
import { JsonProcess, executable, type Frame } from './transport'

/** Sidebar thread titles stay on one short line. */
export const threadTitleLimit = 70
/** Each side of a title prompt. The start of a long message is what the model sees. */
const sourceLimit = 4_000
const titleTimeoutMs = 10_000

const claudePrimary = 'claude-haiku-5-5'
const claudeAlias = 'haiku'
const claudeFallback = 'claude-haiku-4-5-20251001'
const codexModel = 'gpt-5.6-luna'
const piProvider = 'openai-codex'
const piModel = 'gpt-5.6-luna'

export type TitleTarget = { harness: AgentHarness; id: string; provider: string }
export type ThreadTitleInput = {
  harness: AgentHarness
  models: readonly AgentModel[]
  user: string
  response?: string
}

const listed = (
  models: readonly AgentModel[],
  harness: AgentHarness,
  id: string,
  provider?: string
) =>
  models.some(
    (model) =>
      model.available &&
      model.source === 'native' &&
      model.harness === harness &&
      model.id === id &&
      (provider === undefined || model.provider === provider)
  )

/** The cheap model for this harness, or null when the catalog does not list it. */
export function titleModel(
  models: readonly AgentModel[],
  harness: AgentHarness
): TitleTarget | null {
  if (harness === 'claude') {
    const id = listed(models, 'claude', claudePrimary)
      ? claudePrimary
      : listed(models, 'claude', claudeAlias)
        ? claudeAlias
        : listed(models, 'claude', claudeFallback)
          ? claudeFallback
          : null
    return id ? { harness, id, provider: 'configured' } : null
  }
  if (harness === 'codex')
    return listed(models, 'codex', codexModel)
      ? { harness, id: codexModel, provider: 'configured' }
      : null
  return listed(models, 'pi', piModel, piProvider)
    ? { harness, id: piModel, provider: piProvider }
    : null
}

export const threadTitleSlice = (text: string): string => text.trim().slice(0, threadTitleLimit)

const clip = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.length > sourceLimit ? trimmed.slice(0, sourceLimit) : trimmed
}

/** First pass is the user message. Second pass adds that thread's first assistant response. */
export function titlePrompt(user: string, response?: string): string {
  const instruction =
    'Reply with a short title for this conversation and nothing else. One line, no quotes.'
  const body =
    response === undefined
      ? `User:\n${clip(user)}`
      : `User:\n${clip(user)}\n\nAssistant:\n${clip(response)}`
  return `${instruction}\n\n${body}`
}

/** One line, quotes removed, cut at the sidebar limit. Anything else is discarded. */
export function sanitizeTitle(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || /[\r\n]/.test(trimmed)) return null
  const unquoted = trimmed.replace(/^["'`]+|["'`]+$/g, '').trim()
  if (!unquoted || /[\r\n]/.test(unquoted)) return null
  return unquoted.slice(0, threadTitleLimit)
}

const assistantText = (message: Frame): string => {
  const blocks = message.message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block: Frame) => block?.type === 'text' && typeof block.text === 'string')
    .map((block: Frame) => block.text)
    .join('')
}

async function completeClaude(modelId: string, prompt: string): Promise<string> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), titleTimeoutMs)
  const q = query({
    prompt,
    options: {
      abortController,
      cwd: homedir(),
      model: modelId,
      pathToClaudeCodeExecutable: executable('claude'),
      env: { ...shellEnv() },
      tools: [],
      permissionMode: 'dontAsk',
      maxTurns: 1,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      systemPrompt: 'Reply with a short conversation title and nothing else.'
    }
  })
  let text = ''
  try {
    for await (const message of q) {
      if (message.type === 'assistant') {
        const next = assistantText(message as unknown as Frame)
        if (next) text = next
      } else if (message.type === 'result') {
        if (message.subtype !== 'success' || message.is_error)
          throw new Error('Claude title failed.')
        if (message.result.trim()) text = message.result
      }
    }
  } finally {
    clearTimeout(timeout)
    q.close()
  }
  return text
}

async function completeCodex(modelId: string, prompt: string): Promise<string> {
  const server = codexAppServer()
  const started = await server.request('thread/start', {
    cwd: homedir(),
    model: modelId,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    persistExtendedHistory: false
  })
  const threadId = started.thread?.id
  if (!threadId) throw new Error('Codex did not open a thread.')
  let streamed = ''
  let completed = ''
  let turnId: string | undefined
  let settled = false
  let finish: (error?: Error, value?: string) => void = () => {}
  const text = new Promise<string>((resolve, reject) => {
    finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value ?? '')
    }
  })
  const offExit = server.onExit((error) => finish(error))
  const unsubscribe = server.subscribe(threadId, (frame) => {
    const params: Frame = frame.params ?? {}
    if (frame.method === 'item/agentMessage/delta') streamed += params.delta ?? ''
    if (frame.method === 'item/completed' && params.item?.type === 'agentMessage')
      completed = params.item.text ?? completed
    if (frame.method === 'error' && !params.willRetry)
      finish(new Error(params.error?.message ?? 'Codex error.'))
    if (frame.method !== 'turn/completed') return
    if (params.turn?.status === 'failed')
      finish(new Error(params.turn.error?.message ?? 'Codex turn failed.'))
    else finish(undefined, completed || streamed)
  })
  const timeout = setTimeout(() => {
    if (turnId) server.interrupt(threadId, turnId)
    finish(new Error('Codex title timed out.'))
  }, titleTimeoutMs)
  void text.catch(() => {})
  try {
    const turn = await server.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      model: modelId
    })
    turnId = turn.turn?.id
    return await text
  } finally {
    clearTimeout(timeout)
    unsubscribe()
    offExit()
  }
}

async function completePi(provider: string, modelId: string, prompt: string): Promise<string> {
  const rpc = new JsonProcess(
    executable('pi'),
    ['--mode', 'rpc', '--no-session', '--no-extensions'],
    homedir(),
    true
  )
  const timeout = setTimeout(() => rpc.close(), titleTimeoutMs)
  try {
    let text = ''
    const done = new Promise<string>((resolve, reject) => {
      rpc.onExit = reject
      rpc.onFrame = (frame) => {
        if (frame.type === 'message_update' && frame.assistantMessageEvent?.type === 'text_delta')
          text += frame.assistantMessageEvent.delta ?? ''
        if (frame.type === 'message_end' && frame.message?.role === 'assistant') {
          const next = assistantText(frame)
          if (next) text = next
        }
        if (frame.type === 'agent_end') resolve(text)
      }
    })
    void done.catch(() => {})
    await rpc.request('set_model', { provider, modelId })
    await rpc.request('prompt', { message: prompt })
    return await done
  } finally {
    clearTimeout(timeout)
    rpc.close()
  }
}

/** One shot on its own thread. This is not the conversation's live thread. */
export async function completeTitle(target: TitleTarget, prompt: string): Promise<string> {
  if (target.harness === 'claude') return completeClaude(target.id, prompt)
  if (target.harness === 'codex') return completeCodex(target.id, prompt)
  return completePi(target.provider, target.id, prompt)
}

/** Catalog check, one-shot, then sanitizer. A missing model or a bad reply yields null. */
export async function suggestThreadTitle(input: ThreadTitleInput): Promise<string | null> {
  const target = titleModel(input.models, input.harness)
  if (!target) return null
  try {
    return sanitizeTitle(await completeTitle(target, titlePrompt(input.user, input.response)))
  } catch {
    return null
  }
}
