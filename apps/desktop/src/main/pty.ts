import { ipcMain, type WebContents } from 'electron'
import type { TerminalSnapshot, TerminalEvent } from '@cerebro/mux'
import { IPC } from '../shared/ipc'
import { muxCall, onTerminal, onMuxDisconnect } from './mux'

type Attachment = {
  id: number
  workspaceId: number
  paneId: number
  owner: WebContents
  pending: Array<{ sequence: number; bytes: number }>
  queued: number
  snapshot: TerminalSnapshot
}
const attachments = new Map<number, Attachment>()
const early = new Map<string, Array<TerminalEvent & { attachmentId: string }>>()
const earlyOverflow = new Set<string>()
let nextId = 1
let pendingOpens = 0
const watchedOwners = new Set<number>()
function deliver(attachment: Attachment, event: TerminalEvent): void {
  if (attachment.owner.isDestroyed()) return
  if (event.sessionId !== attachment.snapshot.sessionId) {
    attachment.owner.send(IPC.pty.exit, {
      sessionId: attachment.id,
      status: 'disconnected',
      exitCode: 0,
      error: 'Reattaching to restarted shell…'
    })
    attachments.delete(attachment.id)
    void muxCall('terminal.detach', { attachmentId: attachment.snapshot.attachmentId }).catch(
      () => {}
    )
    return
  }
  if (event.type !== 'status') {
    const bytes = Buffer.byteLength(event.data ?? '') + 64
    attachment.pending.push({ sequence: event.sequence, bytes })
    attachment.queued += bytes
    if (attachment.queued > 2 * 1024 * 1024) {
      attachments.delete(attachment.id)
      void muxCall('terminal.detach', { attachmentId: attachment.snapshot.attachmentId }).catch(
        () => {}
      )
      attachment.owner.send(IPC.pty.exit, {
        sessionId: attachment.id,
        status: 'disconnected',
        exitCode: 0,
        error: 'Terminal view fell behind; restoring current screen…'
      })
      return
    }
  }
  if (event.type === 'status')
    attachment.owner.send(IPC.pty.exit, {
      sessionId: attachment.id,
      status: event.status,
      exitCode: event.exitCode ?? 0,
      error: event.error
    })
  else
    attachment.owner.send(IPC.pty.data, {
      sessionId: attachment.id,
      data: event.data ?? '',
      sequence: event.sequence,
      cols: event.cols,
      rows: event.rows
    })
}
onTerminal((event) => {
  const attachment = [...attachments.values()].find(
    (item) => item.snapshot.attachmentId === event.attachmentId
  )
  if (attachment) deliver(attachment, event)
  else if (pendingOpens > 0) {
    const events = early.get(event.attachmentId) ?? []
    if (events.length < 128 && early.size < 128) {
      events.push(event)
      early.set(event.attachmentId, events)
    } else if (earlyOverflow.size < 256) earlyOverflow.add(event.attachmentId)
  }
})
onMuxDisconnect((stopped) => {
  for (const attachment of attachments.values())
    if (!attachment.owner.isDestroyed())
      attachment.owner.send(IPC.pty.exit, {
        sessionId: attachment.id,
        status: stopped ? 'stopped' : 'disconnected',
        exitCode: 0,
        error: stopped ? 'Terminal server stopped.' : 'Reconnecting to terminal server…'
      })
  attachments.clear()
  early.clear()
  earlyOverflow.clear()
})
function owned(id: number, owner: WebContents): Attachment {
  const attachment = attachments.get(id)
  if (!attachment || attachment.owner !== owner) throw new Error('Terminal attachment not found.')
  return attachment
}
export function registerPtyIpc(): void {
  ipcMain.on(IPC.pty.ack, (event, id: number, sequence: number) => {
    const attachment = attachments.get(id)
    if (!attachment || attachment.owner !== event.sender || !Number.isSafeInteger(sequence)) return
    while (attachment.pending.length && attachment.pending[0].sequence <= sequence)
      attachment.queued -= attachment.pending.shift()!.bytes
  })
  ipcMain.handle(IPC.pty.open, async (event, workspaceId: number, paneId: number) => {
    pendingOpens++
    let snapshot: TerminalSnapshot
    try {
      snapshot = await muxCall<TerminalSnapshot>('terminal.attach', { workspaceId, paneId })
    } finally {
      pendingOpens--
    }
    if (earlyOverflow.delete(snapshot.attachmentId!)) {
      early.delete(snapshot.attachmentId!)
      await muxCall('terminal.detach', { attachmentId: snapshot.attachmentId })
      throw new Error('Mux view must resynchronize.')
    }
    if (!watchedOwners.has(event.sender.id)) {
      const ownerId = event.sender.id
      watchedOwners.add(ownerId)
      const cleanup = (): void => {
        for (const [id, attachment] of attachments)
          if (attachment.owner === event.sender) {
            attachments.delete(id)
            void muxCall('terminal.detach', {
              attachmentId: attachment.snapshot.attachmentId
            }).catch(() => {})
          }
      }
      event.sender.on('render-process-gone', cleanup)
      event.sender.on('did-start-navigation', (details) => {
        // Hash routing keeps the renderer and its terminal attachments alive.
        if (details.isMainFrame && !details.isSameDocument) cleanup()
      })
      event.sender.once('destroyed', () => {
        cleanup()
        watchedOwners.delete(ownerId)
      })
    }
    const id = nextId++
    if (event.sender.isDestroyed()) {
      await muxCall('terminal.detach', { attachmentId: snapshot.attachmentId })
      throw new Error('Terminal view closed.')
    }
    const attachment: Attachment = {
      id,
      workspaceId,
      paneId,
      owner: event.sender,
      snapshot,
      pending: [],
      queued: 0
    }
    attachments.set(id, attachment)
    for (const data of early.get(snapshot.attachmentId!) ?? []) deliver(attachment, data)
    early.delete(snapshot.attachmentId!)
    return { ...snapshot, sessionId: id }
  })
  ipcMain.handle(IPC.pty.write, (event, id: number, data: string) => {
    const attachment = owned(id, event.sender)
    return muxCall('terminal.write', {
      workspaceId: attachment.workspaceId,
      paneId: attachment.paneId,
      sessionId: attachment.snapshot.sessionId,
      attachmentId: attachment.snapshot.attachmentId,
      data
    })
  })
  ipcMain.handle(IPC.pty.resize, (event, id: number, cols: number, rows: number) => {
    const attachment = owned(id, event.sender)
    return muxCall('terminal.resize', {
      workspaceId: attachment.workspaceId,
      paneId: attachment.paneId,
      sessionId: attachment.snapshot.sessionId,
      attachmentId: attachment.snapshot.attachmentId,
      cols,
      rows
    })
  })
  ipcMain.handle(IPC.pty.kill, async (event, id: number) => {
    const attachment = attachments.get(id)
    if (!attachment || attachment.owner !== event.sender) return
    attachments.delete(id)
    await muxCall('terminal.detach', { attachmentId: attachment.snapshot.attachmentId })
  })
  ipcMain.handle(IPC.pty.restart, (_event, workspaceId: number, paneId: number) =>
    muxCall('terminal.restart', { workspaceId, paneId })
  )
}
