import { randomUUID } from 'node:crypto'
import { JsonProcess, executable, describe, type Frame } from '../transport'
import type { AgentAdapter } from './adapter'
import { inline, item, model, modalities } from './shared'

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
          entry.reasoning ? ['off', 'minimal', 'low', 'medium', 'high'] : [],
          modalities(entry.input)
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
      await rpc.request('prompt', {
        message: context.text,
        ...(context.attachments?.length
          ? {
              images: context.attachments.map((attachment) => ({
                type: 'image',
                data: inline(attachment),
                mimeType: attachment.mimeType
              }))
            }
          : {})
      })
      context.registerSteer?.(async (text, steerAttachments) => {
        await rpc.request('prompt', {
          message: text,
          streamingBehavior: 'steer',
          ...(steerAttachments.length
            ? {
                images: steerAttachments.map((attachment) => ({
                  type: 'image',
                  data: inline(attachment),
                  mimeType: attachment.mimeType
                }))
              }
            : {})
        })
      })
      await done
      const finalState = await rpc.request('get_state')
      if (finalState.sessionFile) emit({ type: 'binding', nativeId: finalState.sessionFile })
      try {
        const stats = await rpc.request('get_session_stats')
        const usage: Frame = stats.contextUsage ?? {}
        if (usage.tokens != null && usage.contextWindow != null)
          emit({
            type: 'usage',
            usage: {
              usedTokens: usage.tokens,
              contextWindow: usage.contextWindow,
              percentage: usage.percent ?? Math.round((usage.tokens / usage.contextWindow) * 100)
            }
          })
      } catch {
        // Best-effort stats call; a turn's success does not depend on it.
      }
    } finally {
      signal.removeEventListener('abort', abort)
      rpc.onExit = () => {}
      rpc.close()
    }
  }
}
