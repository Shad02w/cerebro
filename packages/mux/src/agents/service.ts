import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type Dirent
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  agentActivityStatus,
  agentFinishedLine,
  backgroundTaskOutcome,
  todoListId,
  chatAttachmentLimits,
  chatImageTypes,
  type AgentAccessMode,
  type AgentAnswer,
  type AgentCatalog,
  type AgentCapabilities,
  type AgentDelta,
  type AgentHarness,
  type AgentModel,
  type AgentRequest,
  type AgentStatusEvent,
  type AgentSession,
  type ChatAttachment,
  type ChatAttachmentContent,
  type ChatCommand,
  type ChatImageType,
  type AgentActivityStatus,
  type AgentBackgroundTask,
  type AgentSubagent,
  type ChatActivityOverview,
  type ChatAgentActivity,
  type ChatSearchHit,
  type ChatSearchQuery,
  type ChatSearchResult,
  type ChatView,
  type AgentSkillList,
  type ChatSkillMention,
  type QueuedMessage,
  skillMentionsFor
} from '@cerebro/core'
import {
  adapters,
  type AgentAdapter,
  type AgentConnection,
  type AutonomousTurn,
  type BackgroundTaskUpdate,
  type ConnectionHost,
  type SubagentUpdate,
  type RunAttachment,
  type RunContext
} from './adapters'
import { executable } from './transport'
import { stopCodexAppServer } from './codex-server'
import { suggestThreadTitle, threadTitleSlice, type ThreadTitleInput } from './title'
import { SessionSearchIndex, sessionSnippet } from './search-index'

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
  /** Registered by the adapter once it has a live handle into the running turn. Absent means this harness/run can't be steered right now. */
  steer?: (text: string, attachments: RunAttachment[], skills?: ChatSkillMention[]) => Promise<void>
}
/** A session's live harness process. Access mode and cwd are launch settings; changing either restarts it. */
type Live = {
  connection?: AgentConnection
  accessMode: AgentAccessMode
  cwd: string
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
    steering: true,
    fork: 'native',
    rewind: 'native'
  },
  codex: {
    resume: true,
    cancel: true,
    approvals: 'commands-and-files',
    questions: true,
    modelSelection: 'between-turns',
    imageInput: true,
    steering: true,
    fork: 'emulated',
    rewind: 'emulated'
  },
  pi: {
    resume: true,
    cancel: true,
    approvals: 'none',
    questions: true,
    modelSelection: 'between-turns',
    imageInput: true,
    steering: true,
    fork: 'emulated',
    rewind: 'native'
  }
}
const rewindMemoryNotice =
  'This agent cannot rewind its own memory. The next message starts a fresh session.'
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
const activityRank: Record<AgentActivityStatus, number> = {
  waiting: 0,
  running: 1,
  failed: 2,
  interrupted: 3,
  finished: 4,
  idle: 5
}
function pendingRequestKind(session: AgentSession): 'approval' | 'question' | undefined {
  for (let index = session.items.length - 1; index >= 0; index--) {
    const request = session.items[index]?.request
    if (request && !request.resolved) return request.kind
  }
  return undefined
}

/** Live pane ids bound to one session, highest first. */
function panesForSession(bindings: Record<string, string>, sessionId: string): number[] {
  const paneIds: number[] = []
  for (const [key, id] of Object.entries(bindings)) {
    if (id !== sessionId) continue
    const paneId = Number(key)
    if (Number.isInteger(paneId) && paneId > 0) paneIds.push(paneId)
  }
  paneIds.sort((a, b) => b - a)
  return paneIds
}

function sessionPreview(session: AgentSession): string {
  for (let index = session.items.length - 1; index >= 0; index -= 1) {
    const item = session.items[index]
    if (!item || item.kind === 'reasoning') continue
    const text = item.text.trim().replace(/\s+/g, ' ')
    if (text) return text.slice(0, 140)
  }
  return ''
}

function toActivity(session: AgentSession, paneIds: number[]): ChatAgentActivity {
  const requestKind = pendingRequestKind(session)
  const status = agentActivityStatus(session)
  return {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    repositoryId: session.repositoryId,
    harness: session.model.harness,
    status,
    title: session.title,
    modelLabel: session.model.label,
    preview: sessionPreview(session),
    ...(requestKind ? { requestKind } : {}),
    ...(status === 'running' && session.runningSince != null
      ? { runningSince: session.runningSince }
      : {}),
    paneId: paneIds[0] ?? null,
    paneIds
  }
}

/**
 * One sidebar row per open session. Open means a live chat pane is bound, including idle,
 * or the turn is still `running` / `waiting` after its pane closed. Stale bindings are ignored.
 */
function visibleAgents(
  sessions: AgentSession[],
  bindings: Record<string, string>,
  liveChatPanes: Set<number>
): ChatAgentActivity[] {
  const agents: ChatAgentActivity[] = []
  for (const session of sessions) {
    const paneIds = panesForSession(bindings, session.id).filter((paneId) =>
      liveChatPanes.has(paneId)
    )
    if (!paneIds.length && !busy(session)) continue
    agents.push(toActivity(session, paneIds))
  }
  return agents.sort(
    (a, b) =>
      activityRank[a.status] - activityRank[b.status] ||
      (b.paneId ?? 0) - (a.paneId ?? 0) ||
      a.harness.localeCompare(b.harness)
  )
}
const readJson = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error(`Cannot read chat storage: ${path}. ${String(error)}`)
  }
}

function lastReply(session: AgentSession): string {
  const text = [...session.items].reverse().find((item) => item.kind === 'text' && item.text.trim())
  return text ? text.text.trim().replace(/\s+/g, ' ').slice(0, 200) : 'Finished the task.'
}

/** Persistent logical sessions. UI attachments never own a native process. */
export class AgentSessions {
  private sessions = new Map<string, AgentSession>()
  private bindings: Record<string, string>
  private favorites: AgentModel[]
  private running = new Map<string, Running>()
  private live = new Map<string, Live>()
  /** Per session, the trailing turn that holds background outcomes reported while idle. */
  private events = new Map<string, string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private catalog?: AgentCatalog
  private loadingCatalog?: Promise<AgentCatalog>
  private skillCache = new Map<string, { at: number; skills: AgentSkillList['skills'] }>()
  private searchIndex?: SessionSearchIndex
  private stopping = false
  constructor(
    private directory: string,
    private publish: (workspaceId: number) => void,
    private drivers: Record<AgentHarness, AgentAdapter> = adapters,
    private onStatus: (event: AgentStatusEvent) => void = () => {},
    private suggestTitle: (input: ThreadTitleInput) => Promise<string | null> = suggestThreadTitle
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    mkdirSync(join(directory, 'attachments'), { recursive: true, mode: 0o700 })
    this.migrateAttachmentLayout()
    try {
      this.searchIndex = SessionSearchIndex.open(join(directory, 'search.sqlite'))
    } catch {
      // A broken sidecar must not stop the agent host. Search reports itself unavailable.
    }
    this.bindings = readJson(join(directory, 'bindings.json'), {})
    this.favorites = readJson(join(directory, 'favorites.json'), [])
    for (const file of readdirSync(directory)) {
      if (!file.startsWith('session-') || !file.endsWith('.json')) continue
      const session = readJson<AgentSession | null>(join(directory, file), null)
      if (!session || session.version !== 1) continue
      if (busy(session)) {
        session.status = 'interrupted'
        session.runningSince = undefined
        session.error = 'The agent host stopped during this turn. The prompt was not replayed.'
        for (const item of session.items) {
          if (item.status === 'running') item.status = 'interrupted'
          if (item.request) item.request.resolved = true
        }
        session.sequence++
        this.persist(session)
      }
      const stoppedChildren = this.stopSubagents(
        session,
        'Stopped because the agent host restarted.'
      )
      if (session.background || stoppedChildren) {
        // Background tasks and child agents belonged to a harness process that no longer exists.
        if (session.background)
          this.stopBackground(session, 'Stopped because the agent host restarted.')
        session.sequence++
        this.persist(session)
      }
      this.sessions.set(session.id, session)
    }
    try {
      this.searchIndex?.sync(this.sessions.values())
    } catch {
      // Startup indexing is best-effort. The next persist fills a session that was missed.
    }
  }
  private atomic(name: string, data: unknown): void {
    const file = join(this.directory, name)
    writeFileSync(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }
  private persist(session: AgentSession): void {
    const { nativeResume: _resume, ...stored } = session
    this.atomic(`session-${session.id}.json`, stored)
    try {
      this.searchIndex?.upsert(session)
    } catch {
      // Index failure must not fail the turn. The JSON file is already written.
    }
  }
  /** One-time upgrade from the old per-session layout. Attachment ids are already unique, so
   *  every file can move straight into the flat root; a fork no longer needs to touch any of this. */
  private migrateAttachmentLayout(): void {
    const root = join(this.directory, 'attachments')
    let entries: Dirent[]
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sessionDir = join(root, entry.name)
      for (const file of readdirSync(sessionDir)) {
        const from = join(sessionDir, file)
        const to = join(root, file)
        try {
          renameSync(from, to)
        } catch {
          // Leave the stray file in its old folder rather than losing it.
        }
      }
      try {
        rmdirSync(sessionDir)
      } catch {
        // Not empty (a rename above failed) — leave it for manual cleanup.
      }
    }
  }
  private attachmentPath(attachment: ChatAttachment): string {
    return join(
      this.directory,
      'attachments',
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
      data: readFileSync(this.attachmentPath(attachment)).toString('base64')
    }
  }
  private paneFor(sessionId: string): number | null {
    const key = Object.keys(this.bindings).find((pane) => this.bindings[pane] === sessionId)
    return key ? Number(key) : null
  }
  private notify(
    session: AgentSession,
    kind: AgentStatusEvent['kind'],
    summary: string,
    request?: AgentStatusEvent['request'],
    command?: string
  ): void {
    try {
      this.onStatus({
        kind,
        workspaceId: session.workspaceId,
        sessionId: session.id,
        paneId: this.paneFor(session.id),
        sessionTitle: session.title,
        summary,
        ...(request ? { request } : {}),
        ...(command ? { command } : {}),
        at: Date.now()
      })
    } catch {
      // Notification delivery must never affect the agent turn.
    }
  }
  private changed(session: AgentSession, immediate = false): void {
    if (!busy(session)) session.runningSince = undefined
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
            session.error = `Agent storage failed: ${String(error)}`
            this.running.get(session.id)?.controller.abort()
          }
          this.publish(session.workspaceId)
        }, 100)
      )
    }
  }
  /** Skills for one harness in a workspace. Failures become an empty list so the composer still opens. */
  async skills(harness: AgentHarness, cwd: string): Promise<AgentSkillList> {
    const key = `${harness}\0${cwd}`
    const cached = this.skillCache.get(key)
    if (cached && Date.now() - cached.at < 15_000) return { skills: cached.skills }
    const load = this.drivers[harness].skills
    if (!load) return { skills: [] }
    try {
      const skills = await load(cwd)
      this.skillCache.set(key, { at: Date.now(), skills })
      return { skills }
    } catch (error) {
      return { skills: [], issue: error instanceof Error ? error.message : String(error) }
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
  /**
   * Workspaces with at least one open session. `liveChatPanes` is the set of chat pane IDs
   * currently present in layout; bindings for closed panes are pruned. A running or waiting
   * turn stays listed after its pane closes.
   */
  overview(liveChatPanes: Iterable<number>): ChatActivityOverview {
    const live = new Set<number>()
    for (const paneId of liveChatPanes) {
      if (Number.isInteger(paneId) && paneId > 0) live.add(paneId)
    }
    const stale = Object.keys(this.bindings)
      .map(Number)
      .filter((paneId) => Number.isInteger(paneId) && paneId > 0 && !live.has(paneId))
    if (stale.length) this.releasePanes(stale)
    const grouped = new Map<number, AgentSession[]>()
    for (const session of this.sessions.values()) {
      const list = grouped.get(session.workspaceId)
      if (list) list.push(session)
      else grouped.set(session.workspaceId, [session])
    }
    const workspaces = [...grouped.entries()].flatMap(([workspaceId, sessions]) => {
      const agents = visibleAgents(sessions, this.bindings, live)
      return agents.length ? [{ workspaceId, agents }] : []
    })
    workspaces.sort((a, b) => a.workspaceId - b.workspaceId)
    return { workspaces }
  }
  /** Ranked session hits for the sidebar search dialog. Synchronous, and not on the exclusive command path. */
  search(query: ChatSearchQuery): ChatSearchResult {
    const workspaceIds = [
      ...new Set(query.workspaceIds.filter((id) => Number.isInteger(id) && id > 0))
    ]
    if (!workspaceIds.length) return { hits: [], total: 0 }
    if (!this.searchIndex) throw new Error('Session search is unavailable.')
    let ranked: string[]
    try {
      ranked = this.searchIndex.rank(query.query, workspaceIds)
    } catch (error) {
      throw new Error(
        `Session search failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    const allowed = new Set(workspaceIds)
    const hits: ChatSearchHit[] = []
    let total = 0
    for (const id of ranked) {
      const session = this.sessions.get(id)
      if (!session || !allowed.has(session.workspaceId)) continue
      const paneIds = panesForSession(this.bindings, session.id)
      const open = paneIds.length > 0 || busy(session)
      if (query.pastOnly && open) continue
      total += 1
      if (hits.length >= 40) continue
      hits.push({
        ...toActivity(session, open ? paneIds : []),
        updatedAt: session.updatedAt,
        snippet: sessionSnippet(session, query.query),
        open
      })
    }
    return { hits, total }
  }
  /** Drop pane bindings when chat panes close so overview tracks open tabs only. */
  releasePanes(paneIds: Iterable<number>): void {
    const next = { ...this.bindings }
    const workspaces = new Set<number>()
    const released = new Set<string>()
    for (const paneId of paneIds) {
      const key = String(paneId)
      const sessionId = next[key]
      if (!sessionId) continue
      delete next[key]
      released.add(sessionId)
      const session = this.sessions.get(sessionId)
      if (session) workspaces.add(session.workspaceId)
    }
    if (!released.size) return
    this.atomic('bindings.json', next)
    this.bindings = next
    for (const sessionId of released) this.releaseIfDetached(sessionId)
    for (const workspaceId of workspaces) this.publish(workspaceId)
  }
  private bound(sessionId: string): boolean {
    return Object.values(this.bindings).includes(sessionId)
  }
  /** Closes the session's harness connection, which stops every background task it owns. */
  private release(sessionId: string): void {
    const entry = this.live.get(sessionId)
    if (!entry) return
    this.live.delete(sessionId)
    entry.connection?.close()
    const session = this.sessions.get(sessionId)
    if (!session) return
    let changed = false
    if (session.background) {
      this.stopBackground(session, 'Stopped when the agent closed.')
      changed = true
    }
    if (this.stopSubagents(session, 'Stopped when the agent closed.')) changed = true
    if (changed) this.changed(session, true)
  }
  /** Settles every running task as stopped: its process is gone and will never report back. */
  private stopBackground(session: AgentSession, summary: string): void {
    for (const task of [...(session.background ?? [])])
      this.settleTask(session, { id: task.id, status: 'stopped', summary })
  }
  /** Applies one task update. Callers persist and publish. */
  private updateTask(session: AgentSession, update: BackgroundTaskUpdate): void {
    if (update.status !== 'running') {
      this.settleTask(session, update)
      return
    }
    const fields = Object.fromEntries(
      Object.entries(update).filter(([, value]) => value !== undefined)
    ) as BackgroundTaskUpdate
    const list = session.background ?? []
    const existing = list.find((task) => task.id === update.id)
    if (existing) Object.assign(existing, fields)
    else list.push({ title: '', startedAt: Date.now(), ...fields })
    session.background = list
  }
  /**
   * Moves a task out of the running list and records how it ended as a `notice` carrying the
   * task. The item that started it takes the matching final status.
   */
  private settleTask(session: AgentSession, update: BackgroundTaskUpdate): void {
    const list = session.background ?? []
    const existing = list.find((task) => task.id === update.id)
    if (!existing) return
    const fields = Object.fromEntries(
      Object.entries(update).filter(([, value]) => value !== undefined)
    ) as BackgroundTaskUpdate
    const task: AgentBackgroundTask = {
      ...existing,
      ...fields,
      endedAt: update.endedAt ?? Date.now()
    }
    const rest = list.filter((entry) => entry !== existing)
    session.background = rest.length ? rest : undefined
    if (task.itemId) {
      const origin = session.items.find(
        (item) => item.id === `${item.turnId}:${task.itemId}` && item.status === 'running'
      )
      if (origin)
        origin.status =
          task.status === 'failed'
            ? 'failed'
            : task.status === 'stopped'
              ? 'interrupted'
              : 'completed'
    }
    const turnId = busy(session) && session.turnId ? session.turnId : this.eventTurn(session)
    session.items.push({
      id: `${turnId}:task:${task.id}`,
      turnId,
      kind: 'notice',
      text: task.summary || backgroundTaskOutcome(task),
      task
    })
  }
  /**
   * Folds one child-agent patch onto `session.subagents`. Finished rows stay on the list.
   * A later patch leaves out fields it does not know, and those keep their previous value.
   * A harness duration replaces a locally guessed elapsed time. A later start or finish
   * without a duration drops that duration so the row follows the new clock.
   * `announce` records one chat line. A later patch on that child refreshes the line.
   */
  private updateSubagent(session: AgentSession, update: SubagentUpdate): void {
    const now = Date.now()
    const terminal = update.status !== 'created' && update.status !== 'running'
    const list = session.subagents ?? []
    const index = list.findIndex((child) => child.id === update.id)
    const { tokens, announce, ...rest } = update
    const fields = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined)
    ) as Partial<SubagentUpdate>
    const dropDuration =
      update.durationMs === undefined &&
      (update.startedAt !== undefined || update.finishedAt !== undefined)
    const merge = (previous: AgentSubagent['tokens']): AgentSubagent['tokens'] | undefined => {
      if (!tokens) return previous
      const next = { ...previous }
      let touched = false
      if (tokens.input !== undefined) {
        next.input = tokens.input
        touched = true
      }
      if (tokens.output !== undefined) {
        next.output = tokens.output
        touched = true
      }
      if (tokens.total !== undefined) {
        next.total = tokens.total
        touched = true
      }
      return touched ? next : previous
    }
    if (index === -1) {
      const child: AgentSubagent = {
        id: update.id,
        title: '',
        status: update.status,
        createdAt: now,
        ...fields
      }
      const merged = merge(undefined)
      if (merged) child.tokens = merged
      if (update.status === 'running' && child.startedAt === undefined) child.startedAt = now
      if (terminal && child.finishedAt === undefined) child.finishedAt = now
      if (dropDuration) delete child.durationMs
      list.push(child)
      session.subagents = list
      this.noteAgentFinish(session, child, announce === true)
      return
    }
    const existing = list[index]
    const next: AgentSubagent = { ...existing, ...fields, id: existing.id }
    const merged = merge(existing.tokens)
    if (merged) next.tokens = merged
    else delete next.tokens
    if (update.status === 'running' && next.startedAt === undefined) next.startedAt = now
    if (terminal && next.finishedAt === undefined) next.finishedAt = now
    if (dropDuration) delete next.durationMs
    list[index] = next
    session.subagents = list
    this.noteAgentFinish(session, next, announce === true)
  }
  /**
   * Writes the one finish line when the harness reported this child's end on the stream.
   * A later token or clock patch refreshes that line. A stop Cerebro invented does not.
   */
  private noteAgentFinish(session: AgentSession, child: AgentSubagent, announce: boolean): void {
    const terminal =
      child.status === 'completed' || child.status === 'failed' || child.status === 'stopped'
    if (!terminal) return
    const index = session.items.findIndex((item) => item.agent?.id === child.id)
    const snapshot: AgentSubagent = {
      ...child,
      ...(child.tokens ? { tokens: { ...child.tokens } } : {})
    }
    if (index === -1) {
      if (!announce) return
      const turnId = busy(session) && session.turnId ? session.turnId : this.eventTurn(session)
      session.items.push({
        id: `${turnId}:agent:${child.id}`,
        turnId,
        kind: 'notice',
        text: agentFinishedLine(snapshot),
        agent: snapshot
      })
      return
    }
    const item = session.items[index]
    item.text = agentFinishedLine(snapshot)
    item.agent = snapshot
  }
  /** Settles every child that has not finished. The row stays on the list. */
  private stopSubagents(session: AgentSession, summary: string): boolean {
    const open = (session.subagents ?? []).filter(
      (child) => child.status === 'created' || child.status === 'running'
    )
    if (!open.length) return false
    for (const child of open)
      this.updateSubagent(session, { id: child.id, status: 'stopped', summary })
    return true
  }
  /** Outcomes reported while idle share one trailing turn until something else is added. */
  private eventTurn(session: AgentSession): string {
    const pending = this.events.get(session.id)
    if (pending && session.items.at(-1)?.turnId === pending) return pending
    const turnId = randomUUID()
    this.events.set(session.id, turnId)
    return turnId
  }
  /** A session no pane shows keeps no process. A running turn finishes first. */
  private releaseIfDetached(sessionId: string | undefined): void {
    if (sessionId && !this.bound(sessionId) && !this.running.has(sessionId)) this.release(sessionId)
  }
  async command(scope: AgentScope, command: ChatCommand): Promise<ChatView> {
    if (this.stopping) throw new Error('Agent host is stopping.')
    if (command.action === 'get') return this.view(scope)
    if (command.action === 'new') {
      const previous = this.bindings[String(scope.paneId)]
      const next = { ...this.bindings }
      delete next[String(scope.paneId)]
      this.atomic('bindings.json', next)
      this.bindings = next
      this.releaseIfDetached(previous)
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
      const previous = this.bindings[String(scope.paneId)]
      const next = { ...this.bindings, [scope.paneId]: session.id }
      this.atomic('bindings.json', next)
      this.bindings = next
      this.releaseIfDetached(previous)
      this.publish(scope.workspaceId)
      return this.view(scope)
    }
    if (command.action === 'fork') return this.fork(scope, command)
    if (command.action === 'rewind') return this.rewind(scope, command)
    if (command.action === 'undo') return this.undo(scope, command)
    let session = this.sessions.get(this.bindings[String(scope.paneId)])
    if (
      session &&
      (session.workspaceId !== scope.workspaceId || session.repositoryId !== scope.repositoryId)
    )
      throw new Error('Conversation scope changed. Start a new Agent.')
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
    if (command.action === 'steer') {
      const runtime = session && this.running.get(session.id)
      if (!session || !runtime?.steer) throw new Error('No active turn to steer.')
      const queued = (session.queue ?? []).find((q) => q.id === command.commandId)
      if (!queued) return this.view(scope) // already steered/removed elsewhere — no-op
      if (
        queued.model.key !== session.model.key ||
        (queued.accessMode ?? 'full') !== (session.accessMode ?? 'full')
      )
        throw new Error(
          'This message was queued with different model or access settings. Remove it and resend, or let it send automatically after this response.'
        )
      const attachments = (queued.attachments ?? []).map((meta) => ({
        ...meta,
        path: this.attachmentPath(meta)
      }))
      // Native call first: on rejection the item stays queued untouched and the error just propagates, like any other action.
      await runtime.steer(queued.text, attachments, queued.skills)
      session.queue = (session.queue ?? []).filter((q) => q.id !== command.commandId)
      session.items.push({
        id: randomUUID(),
        turnId: session.turnId!,
        kind: 'user',
        text: queued.text,
        ...(queued.attachments?.length ? { attachments: queued.attachments } : {})
      })
      this.changed(session, true)
      return this.view(scope)
    }
    if (command.action === 'dequeue') {
      if (session) {
        const queued = (session.queue ?? []).find((q) => q.id === command.commandId)
        for (const meta of queued?.attachments ?? [])
          try {
            unlinkSync(this.attachmentPath(meta))
          } catch {
            // best effort — an already-missing file is not an error
          }
        session.queue = (session.queue ?? []).filter((q) => q.id !== command.commandId)
        this.changed(session, true)
      }
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
    if (
      session &&
      (session.model.harness !== selected.harness || session.model.instance !== selected.instance)
    )
      throw new Error('Changing harness starts a new native conversation. Use New Agent first.')
    // No await between here and the mutation below: this recheck-then-commit sequence must stay atomic,
    // since nothing below the mux server's own request serialization guards against a concurrent command.
    const skills = skillMentionsFor(selected.harness, command.text, command.skills)
    if (session && busy(session)) {
      if (!capabilities[selected.harness].steering) throw new Error('The agent is already working.')
      return this.enqueue(scope, session, command, selected, attachments, accessMode, skills)
    }
    if (session && session.items.length > 1500)
      throw new Error(
        'This conversation reached its display limit. Start a new Agent; the saved transcript is retained.'
      )
    let created = false
    if (!session) {
      const slice = threadTitleSlice(command.text)
      session = {
        version: 1,
        id: randomUUID(),
        workspaceId: scope.workspaceId,
        repositoryId: scope.repositoryId,
        cwd: scope.cwd,
        title: slice,
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
      created = true
    }
    session.cwd = scope.cwd
    session.commands.push(command.commandId)
    let stored: RunAttachment[]
    try {
      stored = this.writeAttachments(attachments)
    } catch (error) {
      session.status = 'failed'
      session.runningSince = undefined
      session.error = 'Could not persist the prompt. It was not sent.'
      throw error
    }
    this.commitRewind(session)
    this.beginTurn(session, command.text, stored, selected, command.reasoning, accessMode, skills)
    if (created) this.scheduleTitle(session.id, command.text)
    return this.view(scope)
  }
  /** Writes attachment bytes to disk and returns their host-owned paths. Pure I/O — callers decide how to handle failure. */
  private writeAttachments(
    attachments: Array<{ meta: ChatAttachment; bytes: Buffer }>
  ): RunAttachment[] {
    const stored: RunAttachment[] = []
    for (const entry of attachments) {
      const path = this.attachmentPath(entry.meta)
      writeFileSync(path, entry.bytes, { mode: 0o600 })
      stored.push({ ...entry.meta, path })
    }
    return stored
  }
  /** Queues a message instead of starting a turn, for a busy session on a harness that supports steering. */
  private enqueue(
    scope: AgentScope,
    session: AgentSession,
    command: ChatCommand,
    selected: AgentModel,
    attachments: Array<{ meta: ChatAttachment; bytes: Buffer }>,
    accessMode: AgentAccessMode,
    skills: ChatSkillMention[]
  ): ChatView {
    const stored = this.writeAttachments(attachments)
    session.commands.push(command.commandId!)
    const queued: QueuedMessage = {
      id: command.commandId!,
      text: command.text!,
      ...(stored.length ? { attachments: stored.map(({ path: _path, ...meta }) => meta) } : {}),
      ...(skills.length ? { skills } : {}),
      model: selected,
      reasoning: command.reasoning,
      accessMode
    }
    session.queue = [...(session.queue ?? []), queued]
    this.changed(session, true)
    return this.view(scope)
  }
  /** Starts a brand-new turn: sets turn/session fields, records the user item, and fires the adapter run. Used for both a live send and an auto-flushed queue item. */
  private beginTurn(
    session: AgentSession,
    text: string,
    attachments: RunAttachment[],
    model: AgentModel,
    reasoning: string | undefined,
    accessMode: AgentAccessMode,
    skills: ChatSkillMention[] = []
  ): void {
    if (session.items.length > 1500) {
      session.status = 'failed'
      session.error =
        'This conversation reached its display limit. Start a new Agent; the saved transcript is retained.'
      this.changed(session, true)
      return
    }
    session.model = model
    session.accessMode = accessMode
    session.reasoning = reasoning
    session.status = 'running'
    session.runningSince = Date.now()
    session.error = undefined
    session.attention = undefined
    session.generation = randomUUID()
    session.turnId = randomUUID()
    session.items.push({
      id: randomUUID(),
      turnId: session.turnId,
      kind: 'user',
      text,
      ...(attachments.length
        ? { attachments: attachments.map(({ path: _path, ...meta }) => meta) }
        : {})
    })
    this.changed(session, true)
    const runtime: Running = {
      controller: new AbortController(),
      requests: new Map(),
      done: Promise.resolve()
    }
    this.running.set(session.id, runtime)
    runtime.done = this.run(session, runtime, (context) =>
      this.connectionFor(session).run({
        ...context,
        text,
        attachments,
        ...(skills.length ? { skills } : {})
      })
    )
  }
  /** The session's live harness process, opened on first use and reused by every later turn. */
  private connectionFor(session: AgentSession): AgentConnection {
    const accessMode = session.accessMode ?? 'full'
    const existing = this.live.get(session.id)
    if (existing?.connection && existing.accessMode === accessMode && existing.cwd === session.cwd)
      return existing.connection
    if (existing?.connection) {
      let changed = false
      if (session.background) {
        this.stopBackground(session, 'Stopped because access settings changed.')
        changed = true
      }
      if (this.stopSubagents(session, 'Stopped because access settings changed.')) changed = true
      if (changed) this.changed(session, true)
    }
    this.release(session.id)
    const entry: Live = { accessMode, cwd: session.cwd }
    this.live.set(session.id, entry)
    entry.connection = this.drivers[session.model.harness].connect(
      structuredClone(session),
      this.host(session, entry)
    )
    if (session.nativeResume) delete session.nativeResume
    return entry.connection
  }
  /** Callbacks for one process. Once the session replaces or closes it, its late events are ignored. */
  private host(session: AgentSession, entry: Live): ConnectionHost {
    const current = (): boolean => this.live.get(session.id) === entry
    return {
      autonomous: () => (current() ? this.autonomous(session) : undefined),
      task: (update) => {
        if (!current()) return
        this.updateTask(session, update)
        this.changed(session, true)
      },
      subagent: (update) => {
        if (!current()) return
        this.updateSubagent(session, update)
        this.changed(session, true)
      },
      idle: (event) => {
        if (!current()) return
        try {
          this.apply(session, event, true)
        } catch {
          // Display limit reached; the native transcript still has it.
        }
      },
      exited: (error) => {
        if (!current()) return
        this.live.delete(session.id)
        // A running turn records the failure when it rejects. An idle session has no turn to do that.
        let changed = false
        if (!this.running.has(session.id)) {
          session.error = error.message
          changed = true
        }
        if (session.background) {
          this.stopBackground(session, 'Stopped because the agent process exited.')
          changed = true
        }
        if (this.stopSubagents(session, 'Stopped because the agent process exited.')) changed = true
        if (changed) this.changed(session, true)
      }
    }
  }
  /**
   * A turn the harness began itself, typically to follow up on a background task that settled.
   * It continues the trailing turn of idle outcomes, so the outcome and the follow-up read as one.
   */
  private autonomous(session: AgentSession): AutonomousTurn | undefined {
    if (this.stopping || busy(session)) return undefined
    const pending = this.events.get(session.id)
    session.status = 'running'
    session.runningSince = Date.now()
    session.error = undefined
    session.attention = undefined
    session.generation = randomUUID()
    session.turnId = pending && session.items.at(-1)?.turnId === pending ? pending : randomUUID()
    this.events.delete(session.id)
    this.changed(session, true)
    const runtime: Running = {
      controller: new AbortController(),
      requests: new Map(),
      done: Promise.resolve()
    }
    this.running.set(session.id, runtime)
    let turn: AutonomousTurn | undefined
    // `run` hands over the context synchronously, so `turn` is set before this returns.
    runtime.done = this.run(
      session,
      runtime,
      (context) =>
        new Promise<void>((resolve, reject) => {
          turn = { context, settle: (error) => (error ? reject(error) : resolve()) }
        })
    )
    return turn
  }
  /**
   * Folds one adapter event into the session. `idle` events arrive between turns, so an item
   * updates in whichever turn already owns it rather than the latest one.
   */
  private apply(session: AgentSession, event: AgentDelta, idle = false): void {
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
    if (event.type === 'evict') {
      const ids = new Set(event.ids.map((id) => `${session.turnId}:${id}`))
      const before = session.items.length
      session.items = session.items.filter((item) => !ids.has(item.id))
      if (session.items.length !== before) this.changed(session, true)
      return
    }
    if (event.type === 'usage') {
      session.contextUsage = event.usage
      this.changed(session, true)
      return
    }
    if (event.type === 'todo') {
      session.todo = event.todo
      this.changed(session, idle)
      return
    }
    if (event.type === 'alert') {
      session.error = event.message
      this.changed(session, true)
      return
    }
    const owner = idle
      ? session.items.find((item) => item.id === `${item.turnId}:${event.item.id}`)?.turnId
      : undefined
    const turnId = owner ?? session.turnId ?? randomUUID()
    const id = `${turnId}:${event.item.id}`
    const existing = session.items.find((item) => item.id === id)
    const next = {
      ...existing,
      ...event.item,
      id,
      turnId,
      text: event.append ? (existing?.text ?? '') + event.item.text : event.item.text
    }
    const projectedSize =
      JSON.stringify(session).length +
      JSON.stringify(next).length -
      (existing ? JSON.stringify(existing).length : 0)
    if (projectedSize > 2_000_000 || (!existing && session.items.length >= 2000))
      throw new Error(
        'Conversation display limit reached. Start a new Agent; native history is retained.'
      )
    if (existing) Object.assign(existing, next)
    else session.items.push(next)
    this.changed(session, idle)
  }
  /** Records Pi user-message entry ids so a later rewind can fork before one of them. */
  private async noteForkPoints(session: AgentSession): Promise<void> {
    if (session.model.harness !== 'pi' || this.stopping) return
    const connection = this.live.get(session.id)?.connection
    if (!connection?.forkPoints) return
    try {
      const points = await connection.forkPoints()
      const users = session.items.filter((item) => item.kind === 'user')
      const next = { ...session.checkpoints }
      let changed = false
      for (let index = 0; index < Math.min(points.length, users.length); index++) {
        const id = users[index].id
        if (next[id] === points[index].entryId) continue
        next[id] = points[index].entryId
        changed = true
      }
      if (!changed) return
      session.checkpoints = next
      this.changed(session, true)
    } catch {
      // A prompt without an entry id cannot rewind. The turn itself succeeded.
    }
  }
  /**
   * Drops a pending rewind as a send is accepted. Claude's next connect resumes at the cut.
   * Pi already branched on rewind. An emulated harness forgets native memory and says so.
   */
  private commitRewind(session: AgentSession): void {
    const rewind = session.rewind
    if (!rewind) return
    const harness = session.model.harness
    if (capabilities[harness].rewind === 'emulated') {
      session.nativeId = undefined
      delete session.nativeResume
      const turnId = session.items.at(-1)?.turnId ?? randomUUID()
      session.items.push({
        id: randomUUID(),
        turnId,
        kind: 'notice',
        text: rewindMemoryNotice
      })
      this.release(session.id)
    } else if (harness === 'claude') {
      if (rewind.resumeAt && session.nativeId)
        session.nativeResume = { at: rewind.resumeAt, fork: true }
      else {
        session.nativeId = undefined
        delete session.nativeResume
      }
      this.release(session.id)
    }
    delete session.rewind
  }
  private sessionFor(scope: AgentScope, sessionId?: string): AgentSession {
    const session = this.sessions.get(sessionId ?? this.bindings[String(scope.paneId)])
    if (
      !session ||
      session.workspaceId !== scope.workspaceId ||
      session.repositoryId !== scope.repositoryId
    )
      throw new Error('Conversation not found in this repository.')
    return session
  }
  /** Hides the chosen prompt and everything after it. Undo restores that tail. */
  private async rewind(scope: AgentScope, command: ChatCommand): Promise<ChatView> {
    const session = this.sessionFor(scope, command.sessionId)
    if (busy(session)) throw new Error('Stop the running turn before rewinding.')
    if (session.queue?.length) throw new Error('Remove queued messages before rewinding.')
    if (session.background?.some((task) => task.status === 'running'))
      throw new Error('Stop background work before rewinding.')
    if (!command.itemId) throw new Error('Choose a prompt to rewind.')
    const pending = session.rewind
    const full = pending ? [...session.items, ...pending.tail] : session.items
    const tipNative = pending?.nativeId ?? session.nativeId
    const tipCheckpoints = pending?.checkpoints ?? session.checkpoints
    const index = full.findIndex((item) => item.id === command.itemId)
    const cut = index === -1 ? undefined : full[index]
    if (!cut || cut.kind !== 'user')
      throw new Error('That prompt is no longer part of this conversation.')
    const opener = full.find((item) => item.turnId === cut.turnId)
    if (opener?.id !== cut.id && !tipCheckpoints?.[cut.id])
      throw new Error('Rewind from the prompt that started this response.')
    const kept = full.slice(0, index)
    const tail = full.slice(index)
    let resumeAt: string | undefined
    if (session.model.harness === 'pi') resumeAt = tipCheckpoints?.[cut.id]
    else if (session.model.harness === 'claude') {
      const last = kept.at(-1)
      if (last && tipCheckpoints?.[last.turnId]) {
        const keptIds = new Set(kept.map((item) => item.id))
        const wholeTurn = full
          .filter((item) => item.turnId === last.turnId)
          .every((item) => keptIds.has(item.id))
        if (wholeTurn) resumeAt = tipCheckpoints[last.turnId]
      }
    }
    if (session.model.harness === 'pi' && tipNative && !resumeAt)
      throw new Error('That prompt cannot be rewound yet.')
    if (pending && session.model.harness === 'pi' && tipNative && session.nativeId !== tipNative) {
      const switched = await this.connectionFor(session).switchSession?.(tipNative)
      if (switched?.cancelled) throw new Error('Rewind was cancelled.')
      session.nativeId = tipNative
    }
    if (session.model.harness === 'pi' && resumeAt) {
      const branched = await this.connectionFor(session).forkBefore?.(resumeAt)
      if (!branched) throw new Error('This agent cannot rewind its own memory.')
      if (branched.cancelled) throw new Error('Rewind was cancelled.')
      if (branched.nativeId) session.nativeId = branched.nativeId
    } else if (session.model.harness !== 'pi') this.release(session.id)
    session.items = kept
    session.turnId = undefined
    session.rewind = {
      itemId: cut.id,
      turnId: cut.turnId,
      tail,
      nativeId: tipNative,
      checkpoints: tipCheckpoints,
      ...(resumeAt ? { resumeAt } : {}),
      displacedDraft: pending?.displacedDraft ?? command.displacedDraft
    }
    this.changed(session, true)
    return this.view(scope)
  }
  /** Puts a pending rewind's tail back and returns the composer draft that was displaced. */
  private async undo(scope: AgentScope, command: ChatCommand): Promise<ChatView> {
    const session = this.sessionFor(scope, command.sessionId)
    const rewind = session.rewind
    if (!rewind) return this.view(scope)
    if (busy(session)) throw new Error('Stop the running turn before rewinding.')
    if (session.model.harness === 'pi' && rewind.nativeId && session.nativeId !== rewind.nativeId) {
      const switched = await this.connectionFor(session).switchSession?.(rewind.nativeId)
      if (switched?.cancelled) throw new Error('Rewind was cancelled.')
    }
    session.items = [...session.items, ...rewind.tail]
    if (rewind.nativeId) session.nativeId = rewind.nativeId
    else if (session.model.harness === 'pi') delete session.nativeId
    session.checkpoints = rewind.checkpoints
    delete session.rewind
    this.changed(session, true)
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
    if (next.todo) next.todo = { ...next.todo, listId: todoListId(next.id) }
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
  /** Asks the cheap model for a thread title without holding the send or the turn. */
  private scheduleTitle(sessionId: string, user: string, response?: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const harness = session.model.harness
    void (async () => {
      try {
        const catalog = await this.models()
        const suggestion = await this.suggestTitle({
          harness,
          models: catalog.models,
          user,
          ...(response === undefined ? {} : { response })
        })
        this.applyTitle(sessionId, suggestion)
      } catch {
        // The current title already names the thread. A title failure is not a failed turn.
      }
    })()
  }
  private applyTitle(sessionId: string, suggestion: string | null): void {
    const session = this.sessions.get(sessionId)
    if (!session || !suggestion || suggestion === session.title) return
    session.title = suggestion
    this.changed(session, true)
  }
  /** Second pass, once, when this thread's first turn settles with assistant text. */
  private noteFirstTurn(session: AgentSession): void {
    if (this.stopping || session.status !== 'idle') return
    const users = session.items.filter((item) => item.kind === 'user' && item.text.trim())
    if (users.length !== 1) return
    const reply = session.items.find((item) => item.kind === 'text' && item.text.trim())
    if (!reply) return
    this.scheduleTitle(session.id, users[0].text, reply.text)
  }
  /** Drives one turn. `start` must receive its context synchronously; `autonomous` relies on it. */
  private async run(
    session: AgentSession,
    runtime: Running,
    start: (context: Omit<RunContext, 'text'>) => Promise<void>
  ): Promise<void> {
    const generation = session.generation
    const emit = (event: AgentDelta): void => {
      if (runtime.controller.signal.aborted || session.generation !== generation) return
      this.apply(session, event)
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
        const approval = request.kind === 'approval' && request.text.trim()
        this.notify(
          session,
          'blocked',
          approval ? request.title : request.text || request.title,
          { id: request.id, kind: request.kind },
          approval ? request.text.trim().slice(0, 1000) : undefined
        )
      })
    }
    const declinePending = (): void => {
      for (const resolve of runtime.requests.values()) resolve({ allow: false, answers: {} })
      runtime.requests.clear()
    }
    runtime.controller.signal.addEventListener('abort', declinePending, { once: true })
    let finishedNotice: string | undefined
    let failedNotice: string | undefined
    try {
      await start({
        session: structuredClone(session),
        signal: runtime.controller.signal,
        emit,
        ask,
        registerSteer: (fn) => {
          runtime.steer = fn
        }
      })
      if (runtime.controller.signal.aborted) {
        session.status = 'interrupted'
        session.attention = undefined
      } else {
        session.status = 'idle'
        session.error = undefined
        session.attention = { kind: 'finished', at: Date.now() }
        finishedNotice = lastReply(session)
      }
    } catch (error) {
      session.status = runtime.controller.signal.aborted ? 'interrupted' : 'failed'
      session.attention = undefined
      if (session.status === 'failed') {
        session.error = String(error)
        failedNotice = session.error
      } else {
        // A user interrupt is not an error; the "interrupted" status already tells the story.
        console.info(`[agents] session ${session.id} interrupted: ${String(error)}`)
      }
    } finally {
      this.noteFirstTurn(session)
      declinePending()
      runtime.controller.signal.removeEventListener('abort', declinePending)
      // Items that started background work stay running until that work settles.
      const background = new Set(
        (session.background ?? []).map((task) => `${session.turnId}:${task.itemId}`)
      )
      for (const entry of session.items.filter((i) => i.turnId === session.turnId)) {
        if (entry.status === 'running' && !background.has(entry.id))
          entry.status = session.status === 'idle' ? 'completed' : 'interrupted'
        if (entry.request) entry.request.resolved = true
      }
      this.running.delete(session.id)
      try {
        this.changed(session, true)
      } catch (error) {
        session.error = `Agent storage failed: ${String(error)}`
        this.publish(session.workspaceId)
      }
      if (failedNotice !== undefined) this.notify(session, 'failed', failedNotice)
      else if (finishedNotice !== undefined && !session.queue?.length)
        this.notify(session, 'finished', finishedNotice)
      // A message queued while this turn ran becomes the next turn automatically, unless this one failed
      // (left for the user to act on) or the host is tearing down (stopWorkspace/shutdown own the queue then).
      if (!this.stopping && session.status !== 'failed' && session.queue?.length) {
        const [next, ...rest] = session.queue
        session.queue = rest
        const attachments = (next.attachments ?? []).map((meta) => ({
          ...meta,
          path: this.attachmentPath(meta)
        }))
        this.beginTurn(
          session,
          next.text,
          attachments,
          next.model,
          next.reasoning,
          next.accessMode ?? 'full',
          next.skills ?? []
        )
      }
      this.releaseIfDetached(session.id)
      await this.noteForkPoints(session)
    }
  }
  async stopWorkspace(workspaceId: number): Promise<void> {
    // A queued message auto-starts a new run from inside the old one's `finally`, synchronously before
    // its `done` resolves — re-snapshot after each round so an auto-flush spawned mid-teardown gets caught too.
    for (;;) {
      const active = [...this.running.entries()].filter(
        ([id]) => this.sessions.get(id)?.workspaceId === workspaceId
      )
      if (!active.length) break
      for (const [id, runtime] of active) {
        runtime.controller.abort()
        this.release(id)
      }
      await Promise.all(active.map(([, runtime]) => runtime.done))
    }
    for (const id of [...this.live.keys()])
      if (this.sessions.get(id)?.workspaceId === workspaceId) this.release(id)
  }
  async shutdown(): Promise<void> {
    this.stopping = true
    for (;;) {
      const active = [...this.running.entries()]
      if (!active.length) break
      for (const [id, runtime] of active) {
        runtime.controller.abort()
        this.release(id)
      }
      await Promise.all(active.map(([, runtime]) => runtime.done))
    }
    for (const id of [...this.live.keys()]) this.release(id)
    stopCodexAppServer()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const session of this.sessions.values()) this.persist(session)
    try {
      this.searchIndex?.close()
    } catch {
      // Closing the sidecar must not change shutdown's result.
    }
    this.searchIndex = undefined
  }
}
