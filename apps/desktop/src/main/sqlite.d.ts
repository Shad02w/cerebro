declare module 'node:sqlite' {
  export interface DatabaseSyncOptions {
    open?: boolean
    enableForeignKeyConstraints?: boolean
    enableDoubleQuotedStringLiterals?: boolean
    readOnly?: boolean
    timeout?: number
  }

  export interface StatementResultingChanges {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }

  export class StatementSync {
    run(...bindParameters: unknown[]): StatementResultingChanges
    get(...bindParameters: unknown[]): unknown
    all(...bindParameters: unknown[]): unknown[]
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
