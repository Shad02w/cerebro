import { chatImageMarkerPattern, type AgentModel } from '@cerebro/core'
import { randomUUID } from 'node:crypto'
import { JsonProcess, executable, describe, type Frame } from '../transport'
import type { AgentAdapter } from './adapter'
import { item, model, modalities } from './shared'

/** Byte spans of `[Image #N]` markers, the shape Codex clients use for UI-owned text elements. */
const textElements = (
  text: string
): Array<{ byteRange: { start: number; end: number }; placeholder: string }> =>
  [...text.matchAll(chatImageMarkerPattern)].map((match) => {
    const start = Buffer.byteLength(text.slice(0, match.index))
    return { byteRange: { start, end: start + Buffer.byteLength(match[0]) }, placeholder: match[0] }
  })
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
                ),
                modalities(entry.inputModalities)
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
        case 'thread/tokenUsage/updated': {
          const usage: Frame = p.tokenUsage ?? {}
          const usedTokens = usage.last?.totalTokens
          const contextWindow = usage.modelContextWindow
          // `last` is the occupied context of the latest model call. `total` is Codex's
          // lifetime sum and must not be treated as the current window.
          if (
            typeof usedTokens === 'number' &&
            typeof contextWindow === 'number' &&
            contextWindow > 0
          ) {
            emit({
              type: 'usage',
              usage: {
                usedTokens,
                contextWindow,
                percentage: Math.round((usedTokens / contextWindow) * 100)
              }
            })
          }
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
      const attachments = context.attachments ?? []
      const turn = await rpc.request('turn/start', {
        threadId,
        input: [
          attachments.length
            ? { type: 'text', text: context.text, text_elements: textElements(context.text) }
            : { type: 'text', text: context.text },
          ...attachments.map((attachment) => ({ type: 'localImage', path: attachment.path }))
        ],
        model: session.model.id || undefined,
        effort: session.reasoning
      })
      turnId = turn.turn.id
      context.registerSteer?.(async (text, steerAttachments) => {
        await rpc.request('turn/steer', {
          threadId,
          expectedTurnId: turnId,
          input: [
            steerAttachments.length
              ? { type: 'text', text, text_elements: textElements(text) }
              : { type: 'text', text },
            ...steerAttachments.map((attachment) => ({ type: 'localImage', path: attachment.path }))
          ]
        })
      })
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
