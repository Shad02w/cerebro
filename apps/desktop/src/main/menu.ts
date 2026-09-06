import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '../shared/ipc'
import { runNativeCommand } from './native-commands'

function focusedWebContents(): Electron.WebContents | null {
  const window = BrowserWindow.getFocusedWindow()
  return window && !window.isDestroyed() ? window.webContents : null
}

/**
 * Build the macOS application menu.
 * Do not put Cmd+W on Close Window — that chord belongs to the renderer keybind
 * module (close tab). Close Window uses Shift+Cmd+W via role: 'close'.
 */
export function setAppMenu(): void {
  if (process.platform !== 'darwin') {
    return
  }

  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Close',
      // No accelerator: Mod+W is owned by the renderer keybind module.
      click: (): void => {
        const contents = focusedWebContents()
        if (!contents) return
        contents.send(IPC.keybinds.menuClose)
      }
    },
    {
      label: 'Close Window',
      accelerator: 'Shift+CommandOrControl+W',
      role: 'close'
    }
  ]

  const viewSubmenu: MenuItemConstructorOptions[] = [
    ...(import.meta.env.DEV
      ? ([
          { role: 'reload' },
          { role: 'forceReload' },
          {
            label: 'Toggle Developer Tools',
            // Accelerator omitted — toggleDevTools is registered in the keybind catalog.
            click: (): void => {
              const contents = focusedWebContents()
              if (!contents) return
              runNativeCommand(contents, 'toggleDevTools')
            }
          },
          { type: 'separator' }
        ] satisfies MenuItemConstructorOptions[])
      : []),
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]

  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { label: 'File', submenu: fileSubmenu },
    { role: 'editMenu' },
    { label: 'View', submenu: viewSubmenu },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
