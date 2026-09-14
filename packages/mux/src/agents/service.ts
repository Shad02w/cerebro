import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  chatAttachmentLimits,
  chatImageTypes,
  type AgentAnswer,
  type AgentCatalog,
  type AgentCapabilities,
  type AgentDelta,
  type AgentHarness,
  type AgentModel,
  type AgentRequest,
  type AgentSession,
  type ChatAttachment,
  type ChatAttachmentContent,
  type ChatCommand,
  type ChatImageType,
  type ChatView
} from '@cerebro/core'
import { adapters, type AgentAdapter, type RunAttachment } from './adapters'
import { executable } from './transport'

export type AgentScope = {
  workspaceId: number
  paneId: number
  repositoryId: number | null
  cwd: string
}
type Running = {
  controller: AbortController
  done: Promise<void>
  requests: Map<string, (answer: AgentAnswer) => void>
}
const harnesses: AgentHarness[] = ['claude', 'codex', 'pi']
const capabilities: Record<AgentHarness, AgentCapabilities> = {
  claude: {
    resume: true,
    cancel: true,
    approvals: 'tools',
    questions: true,
    modelSelection: 'between-turns',
    imageInput: true,
    steering: false,
    fork: 'native'
  },
  codex: {
    resume: true,
    cancel: true,
    approvals: 'commands-and-files',
    questions: true,
    modelSelection: 'between-turns',
    imageInput: true,
    steering: false,
    fork: 'emulated'
  },
  pi: {
    resume: true,
    cancel: true,
    approvals: 'none',
    questions: true,
    modelSelection: 'between-turns',
    imageInput: true,
    steering: false,
    fork: 'emulated'
  }
}
const attachmentId = /^[A-Za-z0-9-]{1,64}$/
const extensions: Record<ChatImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}
const signature = (mimeType: ChatImageType, bytes: Buffer): boolean =>
  mimeType === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mimeType === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mimeType === 'image/gif'
        ? bytes.subarray(0, 4).toString('latin1') === 'GIF8'
        : bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
          bytes.subarray(8, 12).toString('latin1') === 'WEBP'
/** Validates uploads before anything is written. Bytes are returned separately from the persisted metadata. */
function validateAttachments(
  uploads: ChatCommand['attachments']
): Array<{ meta: ChatAttachment; bytes: Buffer }> {
  if (uploads === undefined) return []
  if (!Array.isArray(uploads)) throw new Error('Invalid attachments.')
  if (uploads.length > chatAttachmentLimits.maxCount)
    throw new Error(`Attach at most ${chatAttachmentLimits.maxCount} images per message.`)
  const seen = new Set<string>()
  let total = 0
  return uploads.map((upload) => {
    if (
      !upload ||
      typeof upload !== 'object' ||
      upload.kind !== 'image' ||
      typeof upload.id !== 'string' ||
      !attachmentId.test(upload.id) ||
      typeof upload.name !== 'string' ||
      typeof upload.data !== 'string' ||
      !(chatImageTypes as readonly string[]).includes(upload.mimeType)
    )
      throw new Error('Invalid image attachment.')
    if (seen.has(upload.id)) throw new Error('Duplicate image attachment.')
    seen.add(upload.id)
    const bytes = Buffer.from(upload.data, 'base64')
    if (!bytes.length || bytes.length > chatAttachmentLimits.maxBytes)
      throw new Error(
        `Each image must be at most ${Math.round(chatAttachmentLimits.maxBytes / 1024 / 1024)} MB.`
      )
    if (!signature(upload.mimeType, bytes))
      throw new Error(`${upload.name || 'Image'} is not a valid ${upload.mimeType} file.`)
    total += bytes.length
    if (total > chatAttachmentLimits.maxTotalBytes)
      throw new Error(
        `Images in one message must total at most ${Math.round(chatAttachmentLimits.maxTotalBytes / 1024 / 1024)} MB.`
      )
    const size = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : undefined
    return {
      bytes,
      meta: {
        id: upload.id,
        kind: 'image',
        name: upload.name.slice(0, 200) || 'Image',
        mimeType: upload.mimeType,
        bytes: bytes.length,
        width: size(upload.width),
        height: size(upload.height)
      }
    }
  })
}
const busy = (session: AgentSession): boolean =>
  session.status === 'running' || session.status === 'waiting'
const readJson = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error(`Cannot read chat storage: ${path}. ${String(error)}`)
  }
}

/** Persistent logical sessions. UI attachments never own a native process. */
export class AgentSessions {
  private sessions = new Map<string, AgentSession>()
  private bindings: Record<string, string>
  private favorites: AgentModel[]
  private running = new Map<string, Running>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private catalog?: AgentCatalog
  private loadingCatalog?: Promise<AgentCatalog>
  private stopping = false
  constructor(
    private directory: string,
    private publish: (workspaceId: number) => void,
    private drivers: Record<AgentHarness, AgentAdapter> = adapters
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.bindings = readJson(join(directory, 'bindings.json'), {})
    this.favorites = readJson(join(directory, 'favorites.json'), [])
    for (const file of readdirSync(directory)) {
      if (!file.startsWith('session-') || !file.endsWith('.json')) continue
      const session = readJson<AgentSession | null>(join(directory, file), null)
      if (!session || session.version !== 1) continue
      if (busy(session)) {
        session.status = 'interrupted'
        session.error = 'The agent host stopped during this turn. The prompt was not replayed.'
        for (const item of session.items) {
          if (item.status === 'running') item.status = 'interrupted'
          if (item.request) item.request.resolved = true
        }
        session.sequence++
        this.persist(session)
      }
      this.sessions.set(session.id, session)
    }
  }
  private atomic(name: string, data: unknown): void {
    const file = join(this.directory, name)
    writeFileSync(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }
  private persist(session: AgentSession): void {
    this.atomic(`session-${session.id}.json`, session)
  }
  private attachmentPath(session: AgentSession, attachment: ChatAttachment): string {
    return join(
      this.directory,
      'attachments',
      session.id,
      `${attachment.id}.${extensions[attachment.mimeType]}`
    )
  }
  /** Returns stored image bytes for a transcript item. Sessions are scoped by workspace. */
  attachment(workspaceId: number, sessionId: string, attachmentId: string): ChatAttachmentContent {
    const session = this.sessions.get(sessionId)
    if (!session || session.workspaceId !== workspaceId)
      throw new Error('Conversation not found in this workspace.')
    const attachment = session.items
      .flatMap((item) => item.attachments ?? [])
      .find((entry) => entry.id === attachmentId)
    if (!attachment) throw new Error('Image not found in this conversation.')
    return {
      mimeType: attachment.mimeType,
      data: readFileSync(this.attachmentPath(session, attachment)).toString('base64')
    }
  }
  private changed(session: AgentSession, immediate = false): void {
    session.sequence++
    session.updatedAt = Date.now()
    if (immediate) {
      clearTimeout(this.timers.get(session.id))
      this.timers.delete(session.id)
      this.persist(session)
      this.publish(session.workspaceId)
    } else if (!this.timers.has(session.id)) {
      this.timers.set(
        session.id,
        setTimeout(() => {
          this.timers.delete(session.id)
          try {
            this.persist(session)
          } catch (error) {
            session.error = `Chat storage failed: ${String(error)}`
            this.running.get(session.id)?.controller.abort()
          }
          this.publish(session.workspaceId)
        }, 100)
      )
    }
  }
  async models(refresh = false): Promise<AgentCatalog> {
    if (this.catalog && !refresh) return { ...this.catalog, favorites: this.favorites }
    if (this.loadingCatalog) return this.loadingCatalog
    this.loadingCatalog = (async () => {
      const catalog: AgentCatalog = {
        capabilities,
        models: [],
        favorites: this.favorites,
        issues: {}
      }
      await Promise.all(
        harnesses.map(async (harness) => {
          try {
            catalog.models.push(...(await this.drivers[harness].models(homedir())))
          } catch (error) {
            catalog.issues[harness] = String(error)
            let available = true
            try {
              executable(harness)
            } catch {
              available = false
            }
            catalog.models.push({
              key: JSON.stringify([harness, 'local', 'configured', '']),
              instance: 'local',
              harness,
              provider: 'configured',
              id: '',
              label: 'Native default',
              reasoning: [],
              available,
              source: 'fallback'
            })
          }
        })
      )
      // Native discovery can be empty before login. Retain an explicit default route.
      for (const harness of harnesses)
        if (!catalog.models.some((m) => m.harness === harness))
          catalog.models.push({
            key: JSON.stringify([harness, 'local', 'configured', '']),
            instance: 'local',
            harness,
            provider: 'configured',
            id: '',
            label: 'Native default',
            reasoning: [],
            available: true,
            source: 'fallback'
          })
      catalog.models.sort(
        (a, b) =>
          harnesses.indexOf(a.harness) - harnesses.indexOf(b.harness) ||
          a.provider.localeCompare(b.provider) ||
          a.label.localeCompare(b.label)
      )
      this.catalog = catalog
      return { ...catalog, favorites: this.favorites }
    })().finally(() => {
      this.loadingCatalog = undefined
    })
    return this.loadingCatalog
  }
  async favorite(key: string, favorite: boolean): Promise<AgentCatalog> {
    const catalog = await this.models()
    const selected =
      catalog.models.find((m) => m.key === key) ?? this.favorites.find((m) => m.key === key)
    if (!selected) throw new Error('Model is no longer in the catalog. Refresh models.')
    const next = this.favorites.filter((m) => m.key !== key)
    if (favorite) next.push(selected)
    this.atomic('favorites.json', next)
    this.favorites = next
    return { ...catalog, favorites: next }
  }
  private view(scope: AgentScope): ChatView {
    const id = this.bindings[String(scope.paneId)]
    const candidate = id ? this.sessions.get(id) : undefined
    const inScope = (session: AgentSession): boolean =>
      session.workspaceId === scope.workspaceId && session.repositoryId === scope.repositoryId
    return structuredClone({
      session: candidate && inScope(candidate) ? candidate : null,
      sessions: [...this.sessions.values()]
        .filter(inScope)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(({ id, title, model, status, updatedAt }) => ({ id, title, model, status, updatedAt }))
    })
  }
  async command(scope: AgentScope, command: ChatCommand): Promise<ChatView> {
    if (this.stopping) throw new Error('Agent host is stopping.')
    if (command.action === 'get') return this.view(scope)
    if (command.action === 'new') {
      const next = { ...this.bindings }
      delete next[String(scope.paneId)]
      this.atomic('bindings.json', next)
      this.bindings = next
      this.publish(scope.workspaceId)
      return this.view(scope)
    }
    if (command.action === 'open') {
      const session = this.sessions.get(command.sessionId ?? '')
      if (
        !session ||
        session.workspaceId !== scope.workspaceId ||
        session.repositoryId !== scope.repositoryId
      )
        throw new Error('Conversation not found in this repository.')
      const next = { ...this.bindings, [scope.paneId]: session.id }
      this.atomic('bindings.json', next)
      this.bindings = next
      this.publish(scope.workspaceId)
      return this.view(scope)
    }
    if (command.action === 'fork') return this.fork(scope, command)
    let session = this.sessions.get(this.bindings[String(scope.paneId)])
    if (
      session &&
      (session.workspaceId !== scope.workspaceId || session.repositoryId !== scope.repositoryId)
    )
      throw new Error('Conversation scope changed. Start a new chat.')
    if (command.sessionId && session?.id !== command.sessionId)
      throw new Error('The selected conversation changed. Try again.')
    if (command.action === 'stop') {
      if (session) this.running.get(session.id)?.controller.abort()
      return this.view(scope)
    }
    if (command.action === 'reply') {
      const runtime = session && this.running.get(session.id)
      const resolve = runtime?.requests.get(command.requestId ?? '')
      if (!session || !runtime || !resolve) throw new Error('This request is no longer pending.')
      const pendingItem = session.items.find((item) => item.request?.id === command.requestId)
      if (pendingItem?.request?.questions && command.allow !== false)
        for (const question of pendingItem.request.questions)
          if (!command.answers?.[question.id]?.some((answer) => answer.trim()))
            throw new Error('Answer every question before submitting.')
      runtime.requests.delete(command.requestId!)
      if (pendingItem?.request) {
        pendingItem.request.resolved = true
        pendingItem.status = 'completed'
        pendingItem.text =
          command.allow === false
            ? 'Declined'
            : command.answers
              ? JSON.stringify(command.answers)
              : 'Approved'
      }
      session.status = runtime.requests.size ? 'waiting' : 'running'
      this.changed(session, true)
      resolve({ allow: command.allow !== false, answers: command.answers ?? {} })
      return this.view(scope)
    }
    if (command.action !== 'send') throw new Error('Unknown chat command.')
    if (
      !command.commandId ||
      typeof command.commandId !== 'string' ||
      command.commandId.length > 100
    )
      throw new Error('A unique command ID is required.')
    // Detect duplicates across newly bound panes, including retries after a lost first reply.
    if (
      [...this.sessions.values()].some(
        (s) => s.workspaceId === scope.workspaceId && s.commands.includes(command.commandId!)
      )
    )
      return this.view(scope)
    if (typeof command.text !== 'string' || !command.text.trim())
      throw new Error('Write a message first.')
    if (command.text.length > 100_000) throw new Error('Message exceeds 100,000 characters.')
    const attachments = validateAttachments(command.attachments)
    if (session && busy(session))
      throw new Error('The agent is still working. Stop it or wait before sending another message.')
    const catalog = await this.models()
    const selection = command.model ?? session?.model ?? catalog.models.find((m) => m.available)
    const selected = catalog.models.find((m) => m.key === selection?.key)
    if (!selected?.available)
      throw new Error('Selected model is unavailable. Refresh models or choose another model.')
    if (command.reasoning && !selected.reasoning.includes(command.reasoning))
      throw new Error('Unsupported reasoning setting for this model.')
    if (attachments.length && selected.modalities && !selected.modalities.includes('image'))
      throw new Error(
        `${selected.label} does not accept images. Remove them or choose another model.`
      )
    const accessMode = command.accessMode ?? session?.accessMode ?? 'full'
    if (!['full', 'edit', 'read'].includes(accessMode)) throw new Error('Unsupported access mode.')
    // Recheck after model discovery, which can yield while another send is accepted.
    session = this.sessions.get(this.bindings[String(scope.paneId)])
    if (session?.commands.includes(command.commandId)) return this.view(scope)
    if (session && busy(session)) throw new Error('The agent is already working.')
    if (
      session &&
      (session.model.harness !== selected.harness || session.model.instance !== selected.instance)
    )
      throw new Error('Changing harness starts a new native conversation. Use New chat first.')
    if (session && session.items.length > 1500)
      throw new Error(
        'This conversation reached its display limit. Start a new chat; the saved transcript is retained.'
      )
    if (!session) {
      session = {
        version: 1,
        id: randomUUID(),
        workspaceId: scope.workspaceId,
        repositoryId: scope.repositoryId,
        cwd: scope.cwd,
        title: command.text.trim().slice(0, 70),
        model: selected,
        status: 'idle',
        generation: '',
        sequence: 0,
        updatedAt: Date.now(),
        items: [],
        commands: []
      }
      this.sessions.set(session.id, session)
      this.persist(session)
      const next = { ...this.bindings, [scope.paneId]: session.id }
      this.atomic('bindings.json', next)
      this.bindings = next
    }
    session.model = selected
    session.accessMode = accessMode
    session.reasoning = command.reasoning
    session.cwd = scope.cwd
    session.status = 'running'
    session.error = undefined
    session.generation = randomUUID()
    session.turnId = randomUUID()
    session.commands.push(command.commandId)
    session.items.push({
      id: randomUUID(),
      turnId: session.turnId,
      kind: 'user',
      text: command.text,
      ...(attachments.length ? { attachments: attachments.map((entry) => entry.meta) } : {})
    })
    const stored: RunAttachment[] = []
    try {
      if (attachments.length)
        mkdirSync(join(this.directory, 'attachments', session.id), {
          recursive: true,
          mode: 0o700
        })
      for (const entry of attachments) {
        const path = this.attachmentPath(session, entry.meta)
        writeFileSync(path, entry.bytes, { mode: 0o600 })
        stored.push({ ...entry.meta, path })
      }
      this.changed(session, true)
    } catch (error) {
      session.status = 'failed'
      session.error = 'Could not persist the prompt. It was not sent.'
      throw error
    }
    const activeSession = session
    const runtime: Running = {
      controller: new AbortController(),
      requests: new Map(),
      done: Promise.resolve()
    }
    this.running.set(session.id, runtime)
    runtime.done = this.run(activeSession, command.text, stored, runtime)
    return this.view(scope)
  }
  /** Branches a completed section into a new, independent session. Native memory carries over only for adapters that support it (currently Claude). */
  private async fork(scope: AgentScope, command: ChatCommand): Promise<ChatView> {
    const source = this.sessions.get(command.sessionId ?? this.bindings[String(scope.paneId)])
    if (
      !source ||
      source.workspaceId !== scope.workspaceId ||
      source.repositoryId !== scope.repositoryId
    )
      throw new Error('Conversation not found in this repository.')
    if (busy(source)) throw new Error('Stop the running turn before forking.')
    if (!command.turnId) throw new Error('Choose a section to fork.')
    const cut = source.items.map((item) => item.turnId).lastIndexOf(command.turnId)
    if (cut === -1) throw new Error('That section is no longer part of this conversation.')
    const next: AgentSession = {
      ...structuredClone(source),
      id: randomUUID(),
      title: `${source.title} (fork)`,
      status: 'idle',
      generation: '',
      turnId: undefined,
      sequence: 0,
      error: undefined,
      updatedAt: Date.now(),
      items: structuredClone(source.items.slice(0, cut + 1)),
      commands: [],
      forkedFrom: { sessionId: source.id, turnId: command.turnId },
      nativeId: undefined,
      checkpoints: undefined
    }
    const checkpoint = source.checkpoints?.[command.turnId]
    if (source.model.harness === 'claude' && checkpoint && source.nativeId) {
      try {
        const { forkSession } = await import('@anthropic-ai/claude-agent-sdk')
        const result = await forkSession(source.nativeId, {
          upToMessageId: checkpoint,
          title: next.title,
          dir: source.cwd
        })
        next.nativeId = result.sessionId
      } catch {
        // Native fork failed (e.g. transcript missing); continue with an emulated fork (visible items only).
      }
    }
    this.sessions.set(next.id, next)
    this.persist(next)
    this.publish(next.workspaceId)
    return structuredClone({
      session: next,
      sessions: [...this.sessions.values()]
        .filter((s) => s.workspaceId === next.workspaceId && s.repositoryId === next.repositoryId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(({ id, title, model, status, updatedAt }) => ({ id, title, model, status, updatedAt }))
    })
  }
  private async run(
    session: AgentSession,
    text: string,
    attachments: RunAttachment[],
    runtime: Running
  ): Promise<void> {
    const generation = session.generation
    const emit = (event: AgentDelta): void => {
      if (runtime.controller.signal.aborted || session.generation !== generation) return
      if (event.type === 'binding') {
        if (session.nativeId !== event.nativeId) {
          session.nativeId = event.nativeId
          this.changed(session, true)
        }
        return
      }
      if (event.type === 'checkpoint') {
        if (session.checkpoints?.[event.turnId] !== event.chainId) {
          session.checkpoints = { ...session.checkpoints, [event.turnId]: event.chainId }
          this.changed(session, true)
        }
        return
      }
      const id = `${session.turnId}:${event.item.id}`
      const existing = session.items.find((item) => item.id === id)
      const next = {
        ...existing,
        ...event.item,
        id,
        turnId: session.turnId!,
        text: event.append ? (existing?.text ?? '') + event.item.text : event.item.text
      }
      const projectedSize =
        JSON.stringify(session).length +
        JSON.stringify(next).length -
        (existing ? JSON.stringify(existing).length : 0)
      if (projectedSize > 2_000_000 || (!existing && session.items.length >= 2000))
        throw new Error(
          'Conversation display limit reached. Start a new chat; native history is retained.'
        )
      if (existing) Object.assign(existing, next)
      else session.items.push(next)
      this.changed(session)
    }
    const ask = (request: AgentRequest): Promise<AgentAnswer> => {
      if (runtime.controller.signal.aborted) return Promise.resolve({ allow: false, answers: {} })
      if (runtime.requests.has(request.id)) throw new Error('Duplicate native request.')
      return new Promise((resolve) => {
        runtime.requests.set(request.id, resolve)
        emit({
          type: 'item',
          item: {
            id: `request:${request.id}`,
            kind: 'request',
            title: request.title,
            text: request.text,
            status: 'running',
            request
          }
        })
        session.status = 'waiting'
        this.changed(session, true)
      })
    }
    const declinePending = (): void => {
      for (const resolve of runtime.requests.values()) resolve({ allow: false, answers: {} })
      runtime.requests.clear()
    }
    runtime.controller.signal.addEventListener('abort', declinePending, { once: true })
    try {
      await this.drivers[session.model.harness].run({
        session: structuredClone(session),
        text,
        attachments,
        signal: runtime.controller.signal,
        emit,
        ask
      })
      session.status = runtime.controller.signal.aborted ? 'interrupted' : 'idle'
    } catch (error) {
      session.status = runtime.controller.signal.aborted ? 'interrupted' : 'failed'
      session.error = String(error)
    } finally {
      declinePending()
      runtime.controller.signal.removeEventListener('abort', declinePending)
      for (const entry of session.items.filter((i) => i.turnId === session.turnId)) {
        if (entry.status === 'running')
          entry.status = session.status === 'idle' ? 'completed' : 'interrupted'
        if (entry.request) entry.request.resolved = true
      }
      this.running.delete(session.id)
      try {
        this.changed(session, true)
      } catch (error) {
        session.error = `Chat storage failed: ${String(error)}`
        this.publish(session.workspaceId)
      }
    }
  }
  async stopWorkspace(workspaceId: number): Promise<void> {
    const active = [...this.running.entries()]
      .filter(([id]) => this.sessions.get(id)?.workspaceId === workspaceId)
      .map(([, runtime]) => runtime)
    for (const runtime of active) runtime.controller.abort()
    await Promise.all(active.map((runtime) => runtime.done))
  }
  async shutdown(): Promise<void> {
    this.stopping = true
    const active = [...this.running.values()]
    for (const runtime of active) runtime.controller.abort()
    await Promise.all(active.map((runtime) => runtime.done))
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const session of this.sessions.values()) this.persist(session)
  }
}
