import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { defaultDiagnosticsName, exportDiagnostics, log } from '@cerebro/mux'
import { IPC } from '../shared/ipc'
import type { DiagnosticsExportResult } from '../shared/types'

let running: Promise<DiagnosticsExportResult> | undefined

/**
 * Asks where to save, then writes the support bundle. One export at a time: a second request
 * while the dialog or the write is open joins the first instead of stacking dialogs.
 */
export function exportDiagnosticsWithDialog(
  window?: BrowserWindow | null
): Promise<DiagnosticsExportResult> {
  running ??= (async (): Promise<DiagnosticsExportResult> => {
    const options = {
      title: 'Export diagnostics',
      buttonLabel: 'Export',
      defaultPath: join(app.getPath('downloads'), defaultDiagnosticsName()),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }]
    }
    const parent = window && !window.isDestroyed() ? window : BrowserWindow.getFocusedWindow()
    const chosen = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (chosen.canceled || !chosen.filePath) return { state: 'canceled' }
    const result = await exportDiagnostics({
      outputPath: chosen.filePath,
      app: {
        source: 'desktop',
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
        chrome: process.versions.chrome
      }
    })
    if (process.env.NODE_ENV !== 'test') shell.showItemInFolder(result.path)
    return {
      state: 'saved',
      path: result.path,
      bytes: result.bytes,
      muxRunning: result.muxRunning
    }
  })().finally(() => {
    running = undefined
  })
  return running
}

/** Menu entry point: there is no renderer to show a result, so failures get a native dialog. */
export async function exportDiagnosticsFromMenu(): Promise<void> {
  try {
    await exportDiagnosticsWithDialog()
  } catch (error) {
    log('error', 'diagnostics.export_failed', { error })
    dialog.showErrorBox(
      'Could not export diagnostics',
      error instanceof Error ? error.message : String(error)
    )
  }
}

export function registerDiagnosticsIpc(): void {
  ipcMain.handle(IPC.diagnostics.export, async (event) => {
    try {
      return await exportDiagnosticsWithDialog(BrowserWindow.fromWebContents(event.sender))
    } catch (error) {
      log('error', 'diagnostics.export_failed', { error })
      throw error
    }
  })
}
