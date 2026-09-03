import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getDatabasePath } from './paths'

let db: DatabaseSync | null = null

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  git_url TEXT NOT NULL,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, git_url)
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export function getDb(): DatabaseSync {
  if (db) return db

  const databasePath = getDatabasePath()
  mkdirSync(dirname(databasePath), { recursive: true })

  db = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true
  })
  db.exec(SCHEMA)
  return db
}

export function closeDb(): void {
  if (!db) return
  db.close()
  db = null
}

export function resetDbConnection(): void {
  closeDb()
}

export function databaseFileExists(): boolean {
  return existsSync(getDatabasePath())
}

export function toId(value: number | bigint): number {
  return Number(value)
}
