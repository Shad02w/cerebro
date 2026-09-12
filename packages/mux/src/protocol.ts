import type { ChangedFile, Pane, TerminalContinuation } from '@cerebro/core'
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'

// v2 requires xterm 6 continuation semantics; do not attach to a v1 daemon.
export const VERSION = 2
export const MAX_MESSAGE = 32 * 1024 * 1024
export class MuxError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}
export type Message = {
  id?: string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: string; message: string }
  event?: string
  data?: unknown
}
/** Frames are at most 64 KiB. The high header bit continues the same JSON message.
 * Whole messages remain bounded so an untrusted local peer cannot exhaust memory. */
export class Wire extends EventEmitter {
  private buffer = Buffer.alloc(0)
  private parts: Buffer[] = []
  private bytes = 0
  constructor(readonly socket: Socket) {
    super()
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      while (this.buffer.length >= 4) {
        const header = this.buffer.readUInt32BE(0)
        const size = header & 0x7fffffff
        if (size > 65536 || this.bytes + size > MAX_MESSAGE)
          return socket.destroy(new Error('Mux frame limit exceeded.'))
        if (this.buffer.length < size + 4) break
        this.parts.push(this.buffer.subarray(4, size + 4))
        this.bytes += size
        this.buffer = this.buffer.subarray(size + 4)
        if (header >>> 31) continue
        const data = Buffer.concat(this.parts, this.bytes)
        this.parts = []
        this.bytes = 0
        try {
          const message = JSON.parse(data.toString('utf8'))
          if (!message || typeof message !== 'object' || Array.isArray(message))
            throw new Error('Invalid message.')
          this.emit('message', message)
        } catch {
          socket.destroy(new Error('Invalid mux message.'))
          break
        }
      }
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      this.buffer = Buffer.alloc(0)
      this.parts = []
      this.emit('close')
    })
  }
  send(message: Message): void {
    if (this.socket.destroyed) return
    const payload = Buffer.from(JSON.stringify(message))
    if (
      payload.length > MAX_MESSAGE ||
      this.socket.writableLength > MAX_MESSAGE + 2 * 1024 * 1024
    ) {
      this.socket.destroy(new Error('Mux client must resynchronize.'))
      return
    }
    this.socket.cork()
    for (let offset = 0; offset < payload.length; offset += 65536) {
      const part = payload.subarray(offset, offset + 65536)
      const header = Buffer.alloc(4)
      header.writeUInt32BE(part.length + (offset + part.length < payload.length ? 0x80000000 : 0))
      this.socket.write(header)
      this.socket.write(part)
    }
    this.socket.uncork()
  }
}
export type TerminalInfo = {
  paneId: number
  workspaceId: number
  tabId: number
  projectId: number
  repositoryId: number | null
  sessionId: string
  status: 'running' | 'exited' | 'interrupted' | 'failed'
  error?: string
  cols: number
  rows: number
  sequence: number
  durableSequence?: number
  exitCode?: number
  cwd: string
}
export type TerminalSnapshot = TerminalInfo & {
  continuation?: TerminalContinuation
  scrollback?: number
  data: string
  previousScreen?: string
  readOnly?: boolean
  attachmentId?: string
}
export type TerminalEvent = TerminalInfo & { data?: string; type: 'data' | 'resize' | 'status' }

/** Internal decoded request shape. Public handlers validate fields before use. */
export type RequestParams = {
  fingerprint: string
  reply: unknown
  workspaceId: number
  paneId: number
  tabId: number
  projectId: number
  repositoryId?: number
  action: string
  provider?: boolean
  operationId: string
  directory: string
  gitUrl: string
  branch: string
  from?: string
  deleteFiles: boolean
  version: number
  token: string
  database: string
  width: number
  height: number
  cols: number
  rows: number
  state: Pane['state']
  event: unknown
  file: ChangedFile
  id: string
  result: string
  error?: string
  attachmentId?: string
  takeOwnership?: boolean
  sessionId?: string
  data: string
  scrollback?: number
  format?: string
}
