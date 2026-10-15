import { DatabaseSync } from 'node:sqlite'
import type { AgentSession } from '@cerebro/core'

const tokenPattern = /[^\p{L}\p{N}]+/u

/** Lowercase words of at least two characters. Splits on non-letter, non-digit boundaries. */
export function tokenize(text: string): string[] {
  const tokens = new Set<string>()
  for (const raw of text.toLowerCase().split(tokenPattern)) {
    if (raw.length >= 2) tokens.add(raw)
  }
  return [...tokens]
}

/** Exclusive upper bound for a prefix range. Matches SQLite's binary collation on BMP text. */
function prefixUpperBound(token: string): string {
  const last = token.charCodeAt(token.length - 1)
  return token.slice(0, -1) + String.fromCharCode(last + 1)
}

function isTokenChar(char: string | undefined): boolean {
  return char != null && !tokenPattern.test(char)
}

function termAt(text: string, term: string, prefix: boolean, from = 0): number {
  let cursor = from
  while (cursor <= text.length - term.length) {
    const at = text.indexOf(term, cursor)
    if (at < 0) return -1
    const before = at === 0 || !isTokenChar(text[at - 1])
    const after = text[at + term.length]
    const boundary = prefix || after == null || !isTokenChar(after)
    if (before && boundary) return at
    cursor = at + 1
  }
  return -1
}

function containsTerm(text: string, term: string, prefix: boolean): boolean {
  return termAt(text, term, prefix) >= 0
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function snippetTexts(session: AgentSession): string[] {
  const texts: string[] = []
  for (const item of session.items) {
    if (item.text.trim()) texts.push(item.text)
    if (item.title?.trim()) texts.push(item.title)
    if (item.input?.trim()) texts.push(item.input)
    for (const question of item.request?.questions ?? []) {
      if (question.label.trim()) texts.push(question.label)
      for (const option of question.options ?? []) if (option.trim()) texts.push(option)
    }
    for (const attachment of item.attachments ?? [])
      if (attachment.name.trim()) texts.push(attachment.name)
  }
  for (const todo of session.todo?.items ?? []) if (todo.label.trim()) texts.push(todo.label)
  if (session.todo?.explanation?.trim()) texts.push(session.todo.explanation)
  for (const queued of session.queue ?? []) if (queued.text.trim()) texts.push(queued.text)
  if (session.error?.trim()) texts.push(session.error)
  for (const task of session.background ?? []) {
    if (task.title.trim()) texts.push(task.title)
    if (task.summary?.trim()) texts.push(task.summary)
  }
  for (const child of session.subagents ?? []) {
    if (child.title.trim()) texts.push(child.title)
    if (child.summary?.trim()) texts.push(child.summary)
  }
  if (session.title.trim()) texts.push(session.title)
  return texts
}

/** First plain-text window that contains the query. An empty query uses the first user message. */
export function sessionSnippet(session: AgentSession, query: string): string {
  const terms = tokenize(query)
  if (!terms.length) {
    const user = session.items.find((item) => item.kind === 'user' && item.text.trim())
    return collapse(user?.text || session.title).slice(0, 160)
  }
  const last = terms.length - 1
  for (const text of snippetTexts(session)) {
    const plain = collapse(text)
    const lower = plain.toLowerCase()
    if (!terms.every((term, index) => containsTerm(lower, term, index === last))) continue
    const at = termAt(lower, terms[0], last === 0)
    if (at < 0) continue
    const start = Math.max(0, at - 40)
    const end = Math.min(plain.length, at + 80)
    const slice = plain.slice(start, end).trim()
    return `${start > 0 ? '...' : ''}${slice}${end < plain.length ? '...' : ''}`
  }
  return collapse(session.title).slice(0, 160)
}

type RankRow = { sessionId: string; inTitle: number; updatedAt: number }

/**
 * Token postings for agent sessions. `node:sqlite` has no FTS5, so lookup is an ordinary
 * table: exact tokens, and a prefix range on the last query term.
 */
export class SessionSearchIndex {
  private constructor(private db: DatabaseSync) {}

  static open(path: string): SessionSearchIndex {
    const db = new DatabaseSync(path)
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id INTEGER NOT NULL,
        repository_id INTEGER,
        harness TEXT NOT NULL,
        title TEXT NOT NULL,
        model_label TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS postings (
        token TEXT NOT NULL,
        session_id TEXT NOT NULL,
        in_title INTEGER NOT NULL,
        PRIMARY KEY (token, session_id)
      );
      CREATE INDEX IF NOT EXISTS postings_session ON postings(session_id);
      CREATE INDEX IF NOT EXISTS sessions_workspace ON sessions(workspace_id);
    `)
    return new SessionSearchIndex(db)
  }

  close(): void {
    this.db.close()
  }

  /** Rebuild one session's postings. Caller catches failures so a turn can still persist. */
  upsert(session: AgentSession): void {
    const titleTokens = new Set(tokenize(session.title))
    const tokens = new Set(titleTokens)
    for (const text of snippetTexts(session)) for (const token of tokenize(text)) tokens.add(token)
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions (id, workspace_id, repository_id, harness, title, model_label, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             workspace_id = excluded.workspace_id,
             repository_id = excluded.repository_id,
             harness = excluded.harness,
             title = excluded.title,
             model_label = excluded.model_label,
             updated_at = excluded.updated_at`
        )
        .run(
          session.id,
          session.workspaceId,
          session.repositoryId,
          session.model.harness,
          session.title,
          session.model.label,
          session.updatedAt
        )
      this.db.prepare('DELETE FROM postings WHERE session_id = ?').run(session.id)
      const insert = this.db.prepare(
        'INSERT INTO postings (token, session_id, in_title) VALUES (?, ?, ?)'
      )
      for (const token of tokens) insert.run(token, session.id, titleTokens.has(token) ? 1 : 0)
    })
  }

  /** Fill postings that are missing or older than the session file, and drop rows for sessions that did not load. */
  sync(sessions: Iterable<AgentSession>): void {
    const live = new Set<string>()
    const read = this.db.prepare('SELECT updated_at FROM sessions WHERE id = ?')
    for (const session of sessions) {
      live.add(session.id)
      const row = read.get(session.id) as { updated_at: number } | undefined
      if (!row || row.updated_at !== session.updatedAt) this.upsert(session)
    }
    const stored = this.db.prepare('SELECT id FROM sessions').all() as { id: string }[]
    for (const row of stored) if (!live.has(row.id)) this.remove(row.id)
  }

  /**
   * Session ids in rank order. An empty query lists the scope by `updatedAt`.
   * A query that tokenizes to nothing matches nothing. Title hits sort first.
   */
  rank(query: string, workspaceIds: number[]): string[] {
    const ids = [...new Set(workspaceIds.filter((id) => Number.isInteger(id) && id > 0))]
    if (!ids.length) return []
    const terms = tokenize(query)
    if (query.trim() && !terms.length) return []
    if (!terms.length) return this.recent(ids)
    const marks = new Map<string, { titleHits: number; updatedAt: number }>()
    terms.forEach((term, index) => {
      const rows = this.lookup(term, index === terms.length - 1, ids)
      if (index === 0) {
        for (const row of rows)
          marks.set(row.sessionId, { titleHits: row.inTitle ? 1 : 0, updatedAt: row.updatedAt })
        return
      }
      const next = new Map<string, { titleHits: number; updatedAt: number }>()
      for (const row of rows) {
        const existing = marks.get(row.sessionId)
        if (!existing) continue
        next.set(row.sessionId, {
          titleHits: existing.titleHits + (row.inTitle ? 1 : 0),
          updatedAt: row.updatedAt
        })
      }
      marks.clear()
      for (const [id, mark] of next) marks.set(id, mark)
    })
    return [...marks.entries()]
      .sort(
        (a, b) =>
          b[1].titleHits - a[1].titleHits ||
          b[1].updatedAt - a[1].updatedAt ||
          (a[0] < b[0] ? -1 : 1)
      )
      .map(([id]) => id)
  }

  private recent(workspaceIds: number[]): string[] {
    const placeholders = workspaceIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT id FROM sessions WHERE workspace_id IN (${placeholders}) ORDER BY updated_at DESC, id ASC`
      )
      .all(...workspaceIds) as { id: string }[]
    return rows.map((row) => row.id)
  }

  private lookup(term: string, prefix: boolean, workspaceIds: number[]): RankRow[] {
    const placeholders = workspaceIds.map(() => '?').join(', ')
    const range = prefix ? 'p.token >= ? AND p.token < ?' : 'p.token = ?'
    const params = prefix
      ? [term, prefixUpperBound(term), ...workspaceIds]
      : [term, ...workspaceIds]
    return this.db
      .prepare(
        `SELECT p.session_id AS sessionId, MAX(p.in_title) AS inTitle, s.updated_at AS updatedAt
         FROM postings p
         INNER JOIN sessions s ON s.id = p.session_id
         WHERE ${range} AND s.workspace_id IN (${placeholders})
         GROUP BY p.session_id`
      )
      .all(...params) as RankRow[]
  }

  private remove(sessionId: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM postings WHERE session_id = ?').run(sessionId)
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    })
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // The connection may already have rolled back.
      }
      throw error
    }
  }
}
