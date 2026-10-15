import { skillPromptText, type AgentDelta, type ChatSkillMention } from '@cerebro/core'
import { randomUUID } from 'node:crypto'
import { JsonProcess, executable, describe, type Frame } from '../transport'
import type { AgentAdapter, AutonomousTurn } from './adapter'
import { activeTurn, inline, item, model, modalities } from './shared'
import { piSkills } from '../skills'

const promptText = (text: string, skills?: ChatSkillMention[]): string =>
  skillPromptText(text, skills ?? [])

export const piAdapter: AgentAdapter = {
  async skills(cwd) {
    const rpc = new JsonProcess(
      executable('pi'),
      ['--mode', 'rpc', '--no-session', '--no-extensions'],
      cwd,
      true
    )
    try {
      return piSkills(await rpc.request('get_commands'))
    } finally {
      rpc.close()
    }
  },
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
  connect(session, host) {
    // Pi's rpc events have no child channel. host.subagent stays unused until a frame names one.
    // `agent_end` is the parent turn, not a child, so Pi never sends a child's end on this stream.
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
    let closed = false
    let current: AutonomousTurn | undefined
    let messageId = ''
    // Model and thinking level persist in the process, so they are sent only when they change.
    const applied: { model?: string; thinking?: string } = {}
    const emit = (event: AgentDelta): void =>
      current ? current.context.emit(event) : host.idle(event)
    const out = { emit }
    const finish = (error?: Error): void => {
      const turn = current
      current = undefined
      turn?.settle(error)
    }
    const close = (): void => {
      if (closed) return
      closed = true
      rpc.close()
      finish(new Error('Agent stopped.'))
    }
    const native = {
      interrupt: (): void => void rpc.request('abort').catch(() => {}),
      close
    }
    rpc.onExit = (error) => {
      if (closed) return
      closed = true
      finish(error)
      host.exited(error)
    }
    rpc.onFrame = (frame) => {
      switch (frame.type) {
        case 'message_start':
          if (frame.message?.role === 'assistant') messageId = randomUUID()
          break
        case 'message_update': {
          const e: Frame = frame.assistantMessageEvent ?? {}
          if (e.type === 'text_delta' || e.type === 'thinking_delta')
            item(
              out,
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
                out,
                `${messageId}:${index}`,
                block.type === 'text' ? 'text' : 'reasoning',
                block.text ?? block.thinking ?? '',
                { status: 'completed' }
              )
          }
          if (frame.message.stopReason === 'error')
            finish(new Error(frame.message.errorMessage ?? 'Pi turn failed.'))
          if (frame.message.stopReason === 'aborted') finish(new Error('Turn interrupted.'))
          break
        }
        case 'tool_execution_start':
          item(out, frame.toolCallId, 'tool', '', {
            title: frame.toolName,
            input: describe(frame.args),
            status: 'running'
          })
          break
        case 'tool_execution_update':
          item(out, frame.toolCallId, 'tool', describe(frame.partialResult))
          break
        case 'tool_execution_end':
          item(out, frame.toolCallId, 'tool', describe(frame.result), {
            status: frame.isError ? 'failed' : 'completed'
          })
          break
        case 'agent_end':
          finish()
          break
        case 'extension_ui_request': {
          const turn = current
          if (['confirm', 'select', 'input', 'editor'].includes(frame.method)) {
            if (!turn) {
              rpc.send({ type: 'extension_ui_response', id: frame.id, cancelled: true })
              break
            }
            void turn.context
              .ask({
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
              .catch((error) => {
                if (current === turn) finish(error)
              })
          } else
            item(
              out,
              `extension:${frame.id ?? randomUUID()}`,
              'notice',
              describe(frame.message ?? frame.text ?? frame),
              { title: frame.method }
            )
          break
        }
      }
    }
    return {
      async run(context) {
        if (closed) throw new Error('Pi process is closed.')
        if (current) throw new Error('Pi is already running a turn.')
        if (context.signal.aborted) throw new Error('Turn interrupted.')
        const ended = new Promise<void>((resolve, reject) => {
          current = activeTurn(context, (error) => (error ? reject(error) : resolve()), native)
        })
        void ended.catch(() => {})
        const turn = current
        try {
          const { model: selected, reasoning } = context.session
          const modelKey = `${selected.provider}/${selected.id}`
          if (selected.id && modelKey !== applied.model) {
            await rpc.request('set_model', { provider: selected.provider, modelId: selected.id })
            applied.model = modelKey
          }
          if (reasoning && reasoning !== applied.thinking) {
            await rpc.request('set_thinking_level', { level: reasoning })
            applied.thinking = reasoning
          }
          const state = await rpc.request('get_state')
          if (state.sessionFile) context.emit({ type: 'binding', nativeId: state.sessionFile })
          if (current !== turn) return await ended
          await rpc.request('prompt', {
            message: promptText(context.text, context.skills),
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
          context.registerSteer?.(async (text, steerAttachments, skills) => {
            await rpc.request('prompt', {
              message: promptText(text, skills),
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
        } catch (error) {
          if (current === turn) finish(error instanceof Error ? error : new Error(String(error)))
        }
        await ended
        const finalState = await rpc.request('get_state')
        if (finalState.sessionFile)
          context.emit({ type: 'binding', nativeId: finalState.sessionFile })
        try {
          const stats = await rpc.request('get_session_stats')
          const usage: Frame = stats.contextUsage ?? {}
          if (usage.tokens != null && usage.contextWindow != null)
            context.emit({
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
      },
      async forkPoints() {
        const data = await rpc.request('get_fork_messages')
        const messages = Array.isArray(data.messages) ? data.messages : []
        return messages
          .filter((entry: Frame) => typeof entry.entryId === 'string')
          .map((entry: Frame) => ({
            entryId: String(entry.entryId),
            text: String(entry.text ?? '')
          }))
      },
      async forkBefore(entryId) {
        const result = await rpc.request('fork', { entryId })
        if (result.cancelled) return { cancelled: true }
        const state = await rpc.request('get_state')
        return {
          cancelled: false,
          ...(typeof state.sessionFile === 'string' ? { nativeId: state.sessionFile } : {})
        }
      },
      async switchSession(sessionPath) {
        const result = await rpc.request('switch_session', { sessionPath })
        return { cancelled: Boolean(result.cancelled) }
      },
      close
    }
  }
}
