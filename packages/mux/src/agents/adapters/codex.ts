import { chatImageMarkerPattern, type AgentDelta, type AgentModel } from '@cerebro/core'
import { randomUUID } from 'node:crypto'
import { JsonProcess, executable, describe, type Frame } from '../transport'
import type { AgentAdapter, AutonomousTurn } from './adapter'
import { activeTurn, item, model, modalities } from './shared'
import { codexTodoSnapshot } from '../todo'

/** Byte spans of `[Image #N]` markers, the shape Codex clients use for UI-owned text elements. */
const textElements = (
  text: string
): Array<{ byteRange: { start: number; end: number }; placeholder: string }> =>
  [...text.matchAll(chatImageMarkerPattern)].map((match) => {
    const start = Buffer.byteLength(text.slice(0, match.index))
    return { byteRange: { start, end: start + Buffer.byteLength(match[0]) }, placeholder: match[0] }
  })
async function startCodex(cwd: string): Promise<JsonProcess> {
  const rpc = new JsonProcess(executable('codex'), ['app-server'], cwd)
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
  connect(session, host) {
    // Codex notifications name thread items and shell jobs, not child agents. host.subagent
    // stays unused until a frame is actually a child. Thread token usage is the parent window.
    let rpc: JsonProcess | undefined
    let closed = false
    let current: AutonomousTurn | undefined
    let threadId: string | undefined
    let turnId: string | undefined
    // Commands that have started but not completed, by item id.
    const commands = new Map<string, { command: string; startedAt: number }>()
    // Commands still running when their turn completed: unified-exec background terminals.
    const background = new Set<string>()
    const emit = (event: AgentDelta): void =>
      current ? current.context.emit(event) : host.idle(event)
    const out = { emit }
    const finish = (error?: Error): void => {
      const turn = current
      current = undefined
      turnId = undefined
      turn?.settle(error)
    }
    const close = (): void => {
      if (closed) return
      closed = true
      rpc?.close()
      finish(new Error('Agent stopped.'))
    }
    const native = {
      interrupt: (): void => {
        if (turnId && threadId)
          void rpc?.request('turn/interrupt', { threadId, turnId }).catch(() => {})
      },
      close
    }
    const onFrame = (frame: Frame): void => {
      const p: Frame = frame.params ?? {}
      if (frame.id != null && frame.method) {
        const turn = current
        void (async () => {
          if (!turn) {
            rpc?.send({
              id: frame.id,
              error: { code: -32000, message: 'No Cerebro turn is waiting on this request.' }
            })
            return
          }
          if (frame.method === 'item/tool/requestUserInput') {
            const answer = await turn.context.ask({
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
            rpc?.send({
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
                ? await turn.context.ask({
                    id: String(frame.id),
                    kind: 'approval',
                    title: 'Codex requests permission',
                    text: describe(p.command ?? p.reason ?? p)
                  })
                : { allow: session.accessMode !== 'read' }
            rpc?.send({ id: frame.id, result: { decision: answer.allow ? 'accept' : 'decline' } })
          } else {
            rpc?.send({
              id: frame.id,
              error: { code: -32601, message: `Cerebro does not support ${frame.method}` }
            })
            item(
              turn.context,
              `unsupported:${frame.id}`,
              'notice',
              `Unsupported native request: ${frame.method}. No permission was granted.`
            )
          }
        })().catch((error) => {
          if (current === turn) finish(error instanceof Error ? error : new Error(String(error)))
        })
        return
      }
      if (p.threadId && threadId && p.threadId !== threadId) return
      switch (frame.method) {
        case 'turn/started':
          if (current) turnId = p.turn.id
          break
        case 'item/agentMessage/delta':
          item(out, p.itemId, 'text', p.delta, {}, true)
          break
        case 'item/reasoning/summaryTextDelta':
        case 'item/reasoning/textDelta':
          item(out, p.itemId, 'reasoning', p.delta, {}, true)
          break
        case 'item/commandExecution/outputDelta':
          // A background terminal keeps streaming into the item of the turn that started it.
          if (background.has(p.itemId))
            host.idle({
              type: 'item',
              item: { id: p.itemId, kind: 'tool', text: p.delta },
              append: true
            })
          else item(out, p.itemId, 'tool', p.delta, {}, true)
          break
        case 'turn/plan/updated': {
          // Codex has a per-turn plan. This session list ignores it: the latest plan
          // replaces the one checklist, and older turns do not keep their own copy.
          const snapshot = codexTodoSnapshot(session.id, threadId, p)
          if (snapshot) emit({ type: 'todo', todo: snapshot })
          const plan = (p.plan ?? [])
            .map((step: Frame) => `${step.status === 'completed' ? '✓' : '○'} ${step.step}`)
            .join('\n')
          if (plan) item(out, 'plan', 'plan', plan)
          break
        }
        case 'turn/diff/updated':
          item(out, 'turn-diff', 'diff', p.diff ?? '')
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
          if (native.type === 'commandExecution' && native.id) {
            if (frame.method === 'item/started')
              commands.set(native.id, { command: native.command ?? '', startedAt: Date.now() })
            else commands.delete(native.id)
            if (frame.method === 'item/completed' && background.delete(native.id)) {
              // The late completion is the outcome: Codex reports status, exit code and duration.
              host.idle({
                type: 'item',
                item: {
                  id: native.id,
                  kind: 'tool',
                  text: native.aggregatedOutput ?? '',
                  title: native.command,
                  status
                }
              })
              host.task({
                id: native.id,
                status: status === 'failed' ? 'failed' : 'completed',
                ...(typeof native.exitCode === 'number' ? { exitCode: native.exitCode } : {}),
                endedAt: Date.now()
              })
              break
            }
          }
          if (native.type === 'agentMessage')
            item(out, native.id, 'text', native.text ?? '', { status })
          else if (native.type === 'reasoning' && frame.method === 'item/completed')
            item(
              out,
              native.id,
              'reasoning',
              (native.summary?.length ? native.summary : (native.content ?? [])).join('\n'),
              { status }
            )
          else if (native.type === 'commandExecution')
            item(out, native.id, 'tool', native.aggregatedOutput ?? '', {
              title: native.command,
              status
            })
          else if (native.type === 'fileChange')
            item(
              out,
              native.id,
              'diff',
              (native.changes ?? [])
                .map((change: Frame) => `${change.path}\n${change.diff ?? ''}`)
                .join('\n'),
              { title: 'File changes', status }
            )
          else if (native.type !== 'userMessage' && native.type !== 'reasoning')
            item(out, native.id ?? randomUUID(), 'tool', describe(native.result ?? native), {
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
        case 'turn/completed': {
          // Unified exec yields long-running commands back to the model; they outlive the turn.
          for (const [id, { command, startedAt }] of commands) {
            background.add(id)
            host.task({ id, title: command, status: 'running', itemId: id, startedAt })
          }
          commands.clear()
          if (p.turn?.status === 'failed')
            finish(new Error(p.turn.error?.message ?? 'Codex turn failed.'))
          else if (p.turn?.status === 'interrupted') finish(new Error('Turn interrupted.'))
          else finish()
          break
        }
        case 'error':
          if (!p.willRetry && current) finish(new Error(p.error?.message ?? 'Codex error.'))
          break
      }
    }
    const ready = (async () => {
      const started = await startCodex(session.cwd)
      if (closed) {
        started.close()
        return
      }
      rpc = started
      rpc.onFrame = onFrame
      rpc.onExit = (error) => {
        if (closed) return
        closed = true
        finish(error)
        host.exited(error)
      }
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
    })()
    void ready.catch(() => {})
    return {
      async run(context) {
        if (closed) throw new Error('Codex process is closed.')
        if (current) throw new Error('Codex is already running a turn.')
        if (context.signal.aborted) throw new Error('Turn interrupted.')
        const done = new Promise<void>((resolve, reject) => {
          current = activeTurn(context, (error) => (error ? reject(error) : resolve()), native)
        })
        const turn = current
        try {
          await ready
          if (!rpc || closed) throw new Error('Codex process is closed.')
          const attachments = context.attachments ?? []
          const started = await rpc.request('turn/start', {
            threadId,
            input: [
              attachments.length
                ? { type: 'text', text: context.text, text_elements: textElements(context.text) }
                : { type: 'text', text: context.text },
              ...attachments.map((attachment) => ({ type: 'localImage', path: attachment.path }))
            ],
            model: context.session.model.id || undefined,
            effort: context.session.reasoning
          })
          if (current !== turn) return await done
          turnId = started.turn.id
          context.registerSteer?.(async (text, steerAttachments) => {
            await rpc!.request('turn/steer', {
              threadId,
              expectedTurnId: turnId,
              input: [
                steerAttachments.length
                  ? { type: 'text', text, text_elements: textElements(text) }
                  : { type: 'text', text },
                ...steerAttachments.map((attachment) => ({
                  type: 'localImage',
                  path: attachment.path
                }))
              ]
            })
          })
          if (context.signal.aborted) native.interrupt()
        } catch (error) {
          if (current === turn) finish(error instanceof Error ? error : new Error(String(error)))
        }
        return done
      },
      close
    }
  }
}
