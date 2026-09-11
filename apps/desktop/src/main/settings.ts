import { BrowserWindow, dialog } from 'electron'
import { getSettings } from '@cerebro/core'

export async function pickDirectory(sender: Electron.WebContents): Promise<string | null> {
  return showDirectoryPicker(sender, {
    title: 'Choose default clone location',
    defaultPath: getSettings().defaultCloneDir,
    properties: ['openDirectory', 'createDirectory']
  })
}

export async function pickProjectDirectory(sender: Electron.WebContents): Promise<string | null> {
  return showDirectoryPicker(sender, {
    title: 'Add project folder',
    properties: ['openDirectory']
  })
}

async function showDirectoryPicker(
  sender: Electron.WebContents,
  options: Electron.OpenDialogOptions
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender)
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0] ?? null
}

export { getSettings, setSettings, ensureCloneRoot } from '@cerebro/core'
