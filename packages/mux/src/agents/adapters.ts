import type {
  AgentAnswer,
  AgentDelta,
  AgentHarness,
  AgentModel,
  AgentRequest,
  AgentSession,
  ChatItem
} from '@cerebro/core'
import { randomUUID } from 'node:crypto'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { JsonProcess, executable, describe, type Frame } from './transport'

export type RunContext = {
  session: AgentSession
  text: string
  signal: AbortSignal
  emit: (event: AgentDelta) => void
  ask: (request: AgentRequest) => Promise<AgentAnswer>
}
export interface AgentAdapter {
  models(cwd: string): Promise<AgentModel[]>
  run(context: RunContext): Promise<void>
}
const model = (
  harness: AgentHarness,
  provider: string,
  id: string,
  label: string,
  reasoning: string[] = []
): AgentModel => ({
  key: JSON.stringify([harness, 'local', provider, id]),
  instance: 'local',
  harness,
  provider,
  id,
  label,
  reasoning,
  source: 'native',
  available: true
})
const item = (
  context: RunContext,
  id: string,
  kind: ChatItem['kind'],
  text: string,
  extra: Partial<ChatItem> = {},
  append = false
): void => context.emit({ type: 'item', item: { id, kind, text, ...extra }, append })

async function startCodex(cwd: string, signal?: AbortSignal): Promise<JsonProcess> {
  const rpc = new JsonProcess(executable('codex'), ['app-server'], cwd)
  const abort = (): void => rpc.close()
  signal?.addEventListener('abort', abort, { once: true })
  rpc.child.once('close', () => signal?.removeEventListener('abort', abort))
  if (signal?.aborted) abort()
  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'cerebro', title: 'Cerebro', version: '0.1.0' },
      capabilities: { experimentalApi: true }
    })
    rpc.send({ method: 'initialized', params: {} })
    return rpc
  } catch (error) {
    rpc.close()
    throw error
  }
}

export const codexAdapter: AgentAdapter = {
  async models(cwd) {
    const rpc = await startCodex(cwd)
    try {
      const result: AgentModel[] = []
      let cursor: string | undefined
      do {
        const page = await rpc.request('model/list', { limit: 100, cursor })
        for (const entry of page.data ?? [])
          if (!entry.hidden)
            result.push(
              model(
                'codex',
                'configured',
                entry.model,
                entry.displayName,
                (entry.supportedReasoningEfforts ?? []).map(
                  (effort: Frame) => effort.reasoningEffort
                )
              )
            )
        cursor = page.nextCursor ?? undefined
      } while (cursor && result.length < 1000)
      return result
    } finally {
      rpc.close()
    }
  },
  async run(context) {
    const { session, signal, emit, ask } = context
    const rpc = await startCodex(session.cwd, signal)
    let turnId: string | undefined
    let threadId: string | undefined
    let settled = false
    let finish: () => void = () => {}
    let fail: (error: Error) => void = () => {}
    const done = new Promise<void>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    // Attach rejection handling before startup awaits; native failures can arrive at any time.
    void done.catch(() => {})
    const abort = (): void => {
      if (turnId && threadId)
        void rpc.request('turn/interrupt', { threadId, turnId }).catch(() => {})
      fail(new Error('Turn interrupted.'))
      rpc.close()
    }
    signal.addEventListener('abort', abort, { once: true })
    rpc.onExit = fail
    rpc.onFrame = (frame) => {
      const p: Frame = frame.params ?? {}
      if (frame.id != null && frame.method) {
        void (async () => {
          if (frame.method === 'item/tool/requestUserInput') {
            const answer = await ask({
              id: String(frame.id),
              kind: 'question',
              title: 'Agent question',
              text: '',
              questions: (p.questions ?? []).map((q: Frame) => ({
                id: q.id,
                label: q.question,
                options: q.options?.map((o: Frame) => o.label)
              }))
            })
            rpc.send({
              id: frame.id,
              result: {
                answers: Object.fromEntries(
                  Object.entries(answer.answers).map(([id, answers]) => [id, { answers }])
                )
              }
            })
          } else if (
            ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(
              frame.method
            )
          ) {
            const answer =
              session.accessMode === 'edit'
                ? await ask({
                    id: String(frame.id),
                    kind: 'approval',
                    title: 'Codex requests permission',
                    text: describe(p.command ?? p.reason ?? p)
                  })
                : { allow: session.accessMode !== 'read' }
            rpc.send({ id: frame.id, result: { decision: answer.allow ? 'accept' : 'decline' } })
          } else {
            rpc.send({
              id: frame.id,
              error: { code: -32601, message: `Cerebro does not support ${frame.method}` }
            })
            item(
              context,
              `unsupported:${frame.id}`,
              'notice',
              `Unsupported native request: ${frame.method}. No permission was granted.`
            )
          }
        })().catch((error) => fail(error instanceof Error ? error : new Error(String(error))))
        return
      }
      if (p.threadId && threadId && p.threadId !== threadId) return
      switch (frame.method) {
        case 'turn/started':
          turnId = p.turn.id
          break
        case 'item/agentMessage/delta':
          item(context, p.itemId, 'text', p.delta, {}, true)
          break
        case 'item/reasoning/summaryTextDelta':
        case 'item/reasoning/textDelta':
          item(context, p.itemId, 'reasoning', p.delta, {}, true)
          break
        case 'item/commandExecution/outputDelta':
          item(context, p.itemId, 'tool', p.delta, {}, true)
          break
        case 'turn/plan/updated':
          item(
            context,
            'plan',
            'plan',
            (p.plan ?? [])
              .map((step: Frame) => `${step.status === 'completed' ? '✓' : '○'} ${step.step}`)
              .join('\n')
          )
          break
        case 'turn/diff/updated':
          item(context, 'turn-diff', 'diff', p.diff ?? '')
          break
        case 'item/started':
        case 'item/completed': {
          const native: Frame = p.item ?? {}
          const status =
            frame.method === 'item/started'
              ? 'running'
              : ['failed', 'declined'].includes(native.status) ||
                  (native.exitCode != null && native.exitCode !== 0)
                ? 'failed'
                : 'completed'
          if (native.type === 'agentMessage')
            item(context, native.id, 'text', native.text ?? '', { status })
          else if (native.type === 'reasoning' && frame.method === 'item/completed')
            item(
              context,
              native.id,
              'reasoning',
              (native.summary?.length ? native.summary : (native.content ?? [])).join('\n'),
              { status }
            )
          else if (native.type === 'commandExecution')
            item(context, native.id, 'tool', native.aggregatedOutput ?? '', {
              title: native.command,
              status
            })
          else if (native.type === 'fileChange')
            item(
              context,
              native.id,
              'diff',
              (native.changes ?? [])
                .map((change: Frame) => `${change.path}\n${change.diff ?? ''}`)
                .join('\n'),
              { title: 'File changes', status }
            )
          else if (native.type !== 'userMessage' && native.type !== 'reasoning')
            item(context, native.id ?? randomUUID(), 'tool', describe(native.result ?? native), {
              title: native.type,
              status
            })
          break
        }
        case 'turn/completed':
          settled = true
          if (p.turn?.status === 'failed')
            fail(new Error(p.turn.error?.message ?? 'Codex turn failed.'))
          else if (p.turn?.status === 'interrupted') fail(new Error('Turn interrupted.'))
          else finish()
          break
        case 'error':
          if (!p.willRetry) fail(new Error(p.error?.message ?? 'Codex error.'))
          break
      }
    }
    try {
      if (signal.aborted) throw new Error('Turn interrupted.')
      const result = await rpc.request(session.nativeId ? 'thread/resume' : 'thread/start', {
        ...(session.nativeId ? { threadId: session.nativeId } : {}),
        cwd: session.cwd,
        model: session.model.id || undefined,
        approvalPolicy: session.accessMode === 'edit' ? 'on-request' : 'never',
        sandbox:
          session.accessMode === 'read'
            ? 'read-only'
            : session.accessMode === 'edit'
              ? 'workspace-write'
              : 'danger-full-access',
        persistExtendedHistory: true
      })
      threadId = result.thread.id
      emit({ type: 'binding', nativeId: threadId! })
      if (signal.aborted) throw new Error('Turn interrupted.')
      const turn = await rpc.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: context.text }],
        model: session.model.id || undefined,
        effort: session.reasoning
      })
      turnId = turn.turn.id
      if (signal.aborted) abort()
      await done
    } catch (error) {
      if (signal.aborted) throw new Error('Turn interrupted.')
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
      if (!settled) finish()
      rpc.onExit = () => {}
      rpc.close()
    }
  }
}

export const piAdapter: AgentAdapter = {
  async models(cwd) {
    const rpc = new JsonProcess(
      executable('pi'),
      ['--mode', 'rpc', '--no-session', '--no-extensions'],
      cwd,
      true
    )
    try {
      const result = await rpc.request('get_available_models')
      return (result.models ?? []).map((entry: Frame) =>
        model(
          'pi',
          entry.provider,
          entry.id,
          entry.name ?? entry.id,
          entry.reasoning ? ['off', 'minimal', 'low', 'medium', 'high'] : []
        )
      )
    } finally {
      rpc.close()
    }
  },
  async run(context) {
    const { session, signal, emit, ask } = context
    const rpc = new JsonProcess(
      executable('pi'),
      [
        '--mode',
        'rpc',
        ...(session.accessMode === 'read'
          ? ['--no-extensions', '--tools', 'read,grep,find,ls']
          : session.accessMode === 'edit'
            ? ['--no-extensions', '--tools', 'read,grep,find,ls,edit,write']
            : ['--approve']),
        ...(session.nativeId ? ['--session', session.nativeId] : [])
      ],
      session.cwd,
      true
    )
    let finish: () => void = () => {}
    let fail: (error: Error) => void = () => {}
    const done = new Promise<void>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    void done.catch(() => {})
    let messageId = ''
    const abort = (): void => {
      void rpc.request('abort').catch(() => {})
      fail(new Error('Turn interrupted.'))
      rpc.close()
    }
    signal.addEventListener('abort', abort, { once: true })
    rpc.onExit = fail
    rpc.onFrame = (frame) => {
      switch (frame.type) {
        case 'message_start':
          if (frame.message?.role === 'assistant') messageId = randomUUID()
          break
        case 'message_update': {
          const e: Frame = frame.assistantMessageEvent ?? {}
          if (e.type === 'text_delta' || e.type === 'thinking_delta')
            item(
              context,
              `${messageId}:${e.contentIndex}`,
              e.type === 'text_delta' ? 'text' : 'reasoning',
              e.delta ?? '',
              {},
              true
            )
          break
        }
        case 'message_end': {
          if (frame.message?.role !== 'assistant') break
          for (const [index, block] of (frame.message.content ?? []).entries()) {
            if (block.type === 'text' || block.type === 'thinking')
              item(
                context,
                `${messageId}:${index}`,
                block.type === 'text' ? 'text' : 'reasoning',
                block.text ?? block.thinking ?? '',
                { status: 'completed' }
              )
          }
          if (frame.message.stopReason === 'error')
            fail(new Error(frame.message.errorMessage ?? 'Pi turn failed.'))
          if (frame.message.stopReason === 'aborted') fail(new Error('Turn interrupted.'))
          break
        }
        case 'tool_execution_start':
          item(context, frame.toolCallId, 'tool', '', {
            title: frame.toolName,
            input: describe(frame.args),
            status: 'running'
          })
          break
        case 'tool_execution_update':
          item(context, frame.toolCallId, 'tool', describe(frame.partialResult))
          break
        case 'tool_execution_end':
          item(context, frame.toolCallId, 'tool', describe(frame.result), {
            status: frame.isError ? 'failed' : 'completed'
          })
          break
        case 'agent_end':
          finish()
          break
        case 'extension_ui_request': {
          if (['confirm', 'select', 'input', 'editor'].includes(frame.method)) {
            void ask({
              id: frame.id,
              kind: frame.method === 'confirm' ? 'approval' : 'question',
              title: frame.title ?? 'Pi extension',
              text: frame.message ?? '',
              questions:
                frame.method === 'confirm'
                  ? undefined
                  : [{ id: 'value', label: frame.title ?? 'Answer', options: frame.options }]
            })
              .then((answer) => {
                rpc.send({
                  type: 'extension_ui_response',
                  id: frame.id,
                  ...(frame.method === 'confirm'
                    ? { confirmed: answer.allow }
                    : answer.allow
                      ? { value: answer.answers.value?.join(', ') ?? '' }
                      : { cancelled: true })
                })
              })
              .catch(fail)
          } else
            item(
              context,
              `extension:${frame.id ?? randomUUID()}`,
              'notice',
              describe(frame.message ?? frame.text ?? frame),
              { title: frame.method }
            )
          break
        }
      }
    }
    try {
      if (signal.aborted) throw new Error('Turn interrupted.')
      if (session.model.id)
        await rpc.request('set_model', {
          provider: session.model.provider,
          modelId: session.model.id
        })
      if (session.reasoning) await rpc.request('set_thinking_level', { level: session.reasoning })
      const state = await rpc.request('get_state')
      if (state.sessionFile) emit({ type: 'binding', nativeId: state.sessionFile })
      if (signal.aborted) throw new Error('Turn interrupted.')
      await rpc.request('prompt', { message: context.text })
      await done
      const finalState = await rpc.request('get_state')
      if (finalState.sessionFile) emit({ type: 'binding', nativeId: finalState.sessionFile })
    } finally {
      signal.removeEventListener('abort', abort)
      rpc.onExit = () => {}
      rpc.close()
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
      return entries.map((entry) => model('claude', 'configured', entry.value, entry.displayName))
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
    const q = query({
      prompt: context.text,
      options: {
        cwd: session.cwd,
        pathToClaudeCodeExecutable: executable('claude'),
        env: { ...process.env },
        model: session.model.id || undefined,
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
    try {
      let completed = false
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
            const kind =
              block.type === 'tool_use' ? 'tool' : block.type === 'thinking' ? 'reasoning' : 'text'
            const id = block.id ?? `${messageId}:${e.index}`
            blocks.set(e.index, { id, kind, input: '' })
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
        } else if (frame.type === 'assistant') {
          for (const [index, block] of (frame.message.content ?? []).entries()) {
            const id = block.id ?? `${frame.message.id}:${index}`
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
        } else if (frame.type === 'system' && frame.subtype === 'compact_boundary')
          item(context, randomUUID(), 'notice', 'Native conversation compacted.')
      }
      if (!completed) throw new Error('Claude ended without a turn result.')
    } finally {
      signal.removeEventListener('abort', abort)
      q.close()
    }
  }
}
export const adapters: Record<AgentHarness, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  pi: piAdapter
}
