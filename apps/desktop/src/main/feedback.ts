import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { defaultSessionReportName, exportSessionReport, log } from '@cerebro/mux'
import { IPC } from '../shared/ipc'
import type { SessionReportExportResult, SessionReportRequest } from '../shared/types'

let running: Promise<SessionReportExportResult> | undefined

function isRequest(value: unknown): value is SessionReportRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as SessionReportRequest
  return (
    typeof request.score === 'string' &&
    typeof request.comment === 'string' &&
    typeof request.includeTranscript === 'boolean' &&
    Array.isArray(request.images) &&
    request.session != null &&
    typeof request.session === 'object'
  )
}

/**
 * Asks where to save, then writes one conversation and its images.
 * One report at a time: a second request joins the first instead of stacking dialogs.
 */
export function exportSessionReportWithDialog(
  request: SessionReportRequest,
  window?: BrowserWindow | null
): Promise<SessionReportExportResult> {
  running ??= (async (): Promise<SessionReportExportResult> => {
    const options = {
      title: 'Send session report',
      buttonLabel: 'Send',
      defaultPath: join(app.getPath('downloads'), defaultSessionReportName()),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }]
    }
    const parent = window && !window.isDestroyed() ? window : BrowserWindow.getFocusedWindow()
    const chosen = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (chosen.canceled || !chosen.filePath) return { state: 'canceled' }
    const result = await exportSessionReport({
      outputPath: chosen.filePath,
      input: {
        session: request.session,
        score: request.score,
        comment: request.comment,
        includeTranscript: request.includeTranscript,
        images: request.images,
        app: {
          source: 'desktop',
          version: app.getVersion(),
          packaged: app.isPackaged,
          electron: process.versions.electron,
          chrome: process.versions.chrome
        }
      }
    })
    if (process.env.NODE_ENV !== 'test') shell.showItemInFolder(result.path)
    return { state: 'saved', path: result.path, bytes: result.bytes, images: result.images }
  })().finally(() => {
    running = undefined
  })
  return running
}

export function registerFeedbackIpc(): void {
  ipcMain.handle(IPC.feedback.export, async (event, request: unknown) => {
    if (!isRequest(request)) throw new Error('This conversation cannot be reported.')
    try {
      return await exportSessionReportWithDialog(
        request,
        BrowserWindow.fromWebContents(event.sender)
      )
    } catch (error) {
      log('error', 'session_report.export_failed', { error })
      throw error
    }
  })
}
