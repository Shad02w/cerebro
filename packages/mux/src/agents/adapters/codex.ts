import {
  chatImageMarkerPattern,
  skillPromptText,
  type AgentDelta,
  type AgentModel,
  type AttachmentPolicy,
  type ChatSkillMention
} from '@cerebro/core'
import { randomUUID } from 'node:crypto'
import { describe, type Frame } from '../transport'
import { codexContextUsage } from '../context-usage'
import { codexAppServer, interruptCodexTurn } from '../codex-server'
import type { AgentAdapter, AutonomousTurn, RunAttachment } from './adapter'
import { activeTurn, imagesOf, item, model, modalities, withFilePaths } from './shared'
import { codexTodoSnapshot } from '../todo'
import { codexSkills } from '../skills'

/** Text plus any images. A `/name` chip is rewritten to `$name`; Codex resolves that mention itself. */
const codexTurnInput = (
  text: string,
  attachments: RunAttachment[],
  skills: ChatSkillMention[] = []
): Array<Record<string, unknown>> => {
  const outbound = withFilePaths(skillPromptText(text, skills), attachments)
  return [
    attachments.length
      ? { type: 'text', text: outbound, text_elements: textElements(outbound) }
      : { type: 'text', text: outbound },
    ...imagesOf(attachments).map((attachment) => ({ type: 'localImage', path: attachment.path }))
  ]
}

/** Byte spans of `[Image #N]` markers, the shape Codex clients use for UI-owned text elements. */
const textElements = (
  text: string
): Array<{ byteRange: { start: number; end: number }; placeholder: string }> =>
  [...text.matchAll(chatImageMarkerPattern)].map((match) => {
    const start = Buffer.byteLength(text.slice(0, match.index))
    return { byteRange: { start, end: start + Buffer.byteLength(match[0]) }, placeholder: match[0] }
  })
/** Codex takes images as `localImage` inputs. Other files are read from disk by path, so any type is allowed. */
const codexAttachments: AttachmentPolicy = {
  maxCount: 20,
  maxTotalBytes: 40 * 1024 * 1024,
  image: { maxBytes: 10 * 1024 * 1024, maxEdge: 2000 },
  file: { maxBytes: 20 * 1024 * 1024, extensions: 'any', description: 'any file' }
}
export const codexAdapter: AgentAdapter = {
  attachments: codexAttachments,
  async skills(cwd) {
    const server = codexAppServer()
    return codexSkills(await server.request('skills/list', { cwds: [cwd], forceReload: true }), cwd)
  },
  async models(_cwd) {
    const server = codexAppServer()
    const result: AgentModel[] = []
    let cursor: string | undefined
    do {
      const page = await server.request('model/list', { limit: 100, cursor })
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
  },
  connect(session, host) {
    // Shell jobs that outlive a turn are background tasks. collabAgentToolCall and
    // subAgentActivity are child agents on this same pipe; other threads are ignored.
    const server = codexAppServer()
    let unsubscribe = (): void => {}
    let offExit = (): void => {}
    let closed = false
    let current: AutonomousTurn | undefined
    let threadId: string | undefined
    let turnId: string | undefined
    // Commands that have started but not completed, by item id.
    const commands = new Map<string, { command: string; startedAt: number }>()
    // Commands still running when their turn completed: unified-exec background terminals.
    const background = new Set<string>()
    // Child agents named on this parent thread, keyed by their own thread id.
    const children = new Map<string, { title?: string; status: string }>()
    const childStatus = (status: unknown, fallback: string): string => {
      switch (status) {
        case 'pendingInit':
          return 'created'
        case 'running':
        case 'inProgress':
          return 'running'
        case 'completed':
          return 'completed'
        case 'failed':
        case 'errored':
          return 'failed'
        case 'interrupted':
        case 'shutdown':
        case 'notFound':
          return 'stopped'
        default:
          return fallback
      }
    }
    const pathTitle = (value: unknown): string | undefined => {
      if (typeof value !== 'string' || !value.trim()) return undefined
      const parts = value.split('/').filter(Boolean)
      return parts.at(-1) || value
    }
    const promptTitle = (value: unknown): string | undefined => {
      if (typeof value !== 'string' || !value.trim()) return undefined
      return value.trim().split('\n')[0]?.slice(0, 80)
    }
    const reportChild = (
      id: string,
      status: string,
      extra: {
        title?: string
        model?: string
        effort?: string
        startedAt?: number
        finishedAt?: number
        durationMs?: number
        announce?: boolean
      } = {}
    ): void => {
      const previous = children.get(id)
      const title = previous?.title || extra.title
      children.set(id, { title, status })
      host.subagent({
        id,
        status: status as 'created' | 'running' | 'completed' | 'failed' | 'stopped',
        ...(title ? { title } : {}),
        ...(extra.model ? { model: extra.model } : {}),
        ...(extra.effort ? { effort: extra.effort } : {}),
        ...(extra.startedAt !== undefined ? { startedAt: extra.startedAt } : {}),
        ...(extra.finishedAt !== undefined ? { finishedAt: extra.finishedAt } : {}),
        ...(extra.durationMs !== undefined ? { durationMs: extra.durationMs } : {}),
        ...(extra.announce ? { announce: true } : {})
      })
    }
    // Clock, model, and effort are read only from the child they name. A collab item's own
    // startedAtMs and model belong to the tool call, not to every receiver.
    const textField = (value: unknown): string | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      if (typeof value !== 'string') return undefined
      const trimmed = value.trim()
      return trimmed ? trimmed : undefined
    }
    const childFields = (
      source: Frame
    ): {
      startedAt?: number
      finishedAt?: number
      durationMs?: number
      model?: string
      effort?: string
    } => {
      const model = textField(source.model)
      const effort = textField(source.effort ?? source.reasoningEffort)
      return {
        ...(typeof source.startedAtMs === 'number' ? { startedAt: source.startedAtMs } : {}),
        ...(typeof source.completedAtMs === 'number' ? { finishedAt: source.completedAtMs } : {}),
        ...(typeof source.durationMs === 'number' ? { durationMs: source.durationMs } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {})
      }
    }
    const noteActivity = (native: Frame): void => {
      const id = String(native.agentThreadId ?? '')
      if (!id) return
      const stopped = native.kind === 'interrupted'
      const clock = childFields(native)
      if (clock.durationMs === 0) delete clock.durationMs
      if (!stopped) delete clock.finishedAt
      const finishedAt = stopped ? (clock.finishedAt ?? Date.now()) : undefined
      reportChild(id, stopped ? 'stopped' : 'running', {
        title: pathTitle(native.agentPath),
        ...clock,
        ...(finishedAt !== undefined ? { finishedAt } : {}),
        ...(stopped ? { announce: true } : {})
      })
    }
    const noteCollab = (native: Frame, phase: 'item/started' | 'item/completed'): void => {
      const states: Frame = native.agentsStates ?? {}
      const ids = new Set<string>([
        ...Object.keys(states),
        ...(Array.isArray(native.receiverThreadIds)
          ? native.receiverThreadIds.map((id: unknown) => String(id))
          : [])
      ])
      const title = promptTitle(native.prompt)
      for (const id of ids) {
        const state: Frame = states[id] ?? {}
        // The collab item finishing is the parent's tool call, not that child's end.
        const named = typeof state.status === 'string'
        const status = named
          ? childStatus(state.status, 'running')
          : (children.get(id)?.status ?? 'running')
        const clock = childFields(state)
        const elapsed =
          clock.durationMs ??
          (clock.finishedAt !== undefined && clock.startedAt !== undefined
            ? clock.finishedAt - clock.startedAt
            : undefined)
        const terminal =
          phase === 'item/completed' &&
          named &&
          status !== 'created' &&
          status !== 'running' &&
          elapsed !== 0
        if (clock.durationMs === 0) delete clock.durationMs
        const keep =
          !named && (status === 'completed' || status === 'failed' || status === 'stopped')
        const reported = terminal
          ? status
          : keep
            ? status
            : status === 'created'
              ? 'created'
              : 'running'
        const ownFinish = clock.finishedAt
        if (!terminal) delete clock.finishedAt
        const finishedAt = terminal ? (ownFinish ?? Date.now()) : undefined
        reportChild(id, reported, {
          title,
          ...clock,
          ...(finishedAt !== undefined ? { finishedAt } : {}),
          ...(terminal ? { announce: true } : {})
        })
      }
    }
    const childTokens = (thread: string, usage: Frame): void => {
      const counts: Frame = usage.total ?? usage.last ?? {}
      const input = typeof counts.inputTokens === 'number' ? counts.inputTokens : undefined
      const output = typeof counts.outputTokens === 'number' ? counts.outputTokens : undefined
      const total = typeof counts.totalTokens === 'number' ? counts.totalTokens : undefined
      if (input === undefined && output === undefined && total === undefined) return
      const known = children.get(thread)
      if (!known) return
      host.subagent({
        id: thread,
        status: known.status as 'created' | 'running' | 'completed' | 'failed' | 'stopped',
        tokens: {
          ...(input !== undefined ? { input } : {}),
          ...(output !== undefined ? { output } : {}),
          ...(total !== undefined ? { total } : {})
        }
      })
    }
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
      unsubscribe()
      offExit()
      if (threadId && turnId) interruptCodexTurn(threadId, turnId)
      const error = new Error('Agent stopped.')
      finish(error)
      host.exited(error)
    }
    const native = {
      interrupt: (): void => {
        if (turnId && threadId) interruptCodexTurn(threadId, turnId)
      },
      close
    }
    const onFrame = (frame: Frame): void => {
      const p: Frame = frame.params ?? {}
      if (frame.id != null && frame.method) {
        const turn = current
        void (async () => {
          if (!turn) {
            server.send({
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
            server.send({
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
            server.send({ id: frame.id, result: { decision: answer.allow ? 'accept' : 'decline' } })
          } else {
            server.send({
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
      // Child usage arrives on the same pipe, addressed to that child's thread. Do not
      // subscribe to it, and do not copy usage from any thread that is not that child.
      if (
        frame.method === 'thread/tokenUsage/updated' &&
        typeof p.threadId === 'string' &&
        children.has(p.threadId)
      ) {
        childTokens(p.threadId, p.tokenUsage ?? {})
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
          if (native.type === 'collabAgentToolCall') {
            noteCollab(native, frame.method)
            break
          }
          if (native.type === 'subAgentActivity') {
            noteActivity(native)
            break
          }
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
          // `last` is the occupied context of the latest model call. `total` is Codex's
          // lifetime sum and must not be treated as the current window.
          const usage = codexContextUsage(p.tokenUsage ?? {})
          if (usage) emit({ type: 'usage', usage })
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
        case 'error': {
          const message = p.error?.message ?? (p.willRetry ? 'Codex will retry.' : 'Codex error.')
          if (p.willRetry) emit({ type: 'alert', message })
          else if (current) finish(new Error(message))
          else emit({ type: 'alert', message })
          break
        }
      }
    }
    const ready = (async () => {
      // A saved nativeId always resumes. A failed resume leaves that id in place for the next send.
      try {
        offExit = server.onExit((error) => {
          if (closed) return
          closed = true
          unsubscribe()
          finish(error)
          host.exited(error)
        })
        if (closed) return
        const result = await server.request(session.nativeId ? 'thread/resume' : 'thread/start', {
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
        if (closed) return
        const opened = result.thread?.id
        if (typeof opened !== 'string' || !opened) throw new Error('Codex did not open a thread.')
        threadId = opened
        unsubscribe = server.subscribe(opened, onFrame)
        emit({ type: 'binding', nativeId: opened })
      } catch (error) {
        if (!closed) {
          closed = true
          unsubscribe()
          offExit()
          host.exited(error instanceof Error ? error : new Error(String(error)))
        }
        throw error
      }
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
          if (closed || !threadId) throw new Error('Codex process is closed.')
          const attachments = context.attachments ?? []
          const started = await server.request('turn/start', {
            threadId,
            input: codexTurnInput(context.text, attachments, context.skills),
            model: context.session.model.id || undefined,
            effort: context.session.reasoning
          })
          if (current !== turn) return await done
          turnId = started.turn.id
          context.registerSteer?.(async (text, steerAttachments, skills) => {
            await server.request('turn/steer', {
              threadId,
              expectedTurnId: turnId,
              input: codexTurnInput(text, steerAttachments, skills)
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
