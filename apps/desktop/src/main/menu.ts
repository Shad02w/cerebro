import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  MenuItem,
  type MenuItemConstructorOptions
} from 'electron'
import { IPC } from '../shared/ipc'
import { runNativeCommand } from './native-commands'
import { stopMuxForQuit } from './mux'

let quittingCompletely = false

async function quitCompletely(): Promise<void> {
  if (quittingCompletely) return
  quittingCompletely = true
  // A second Quit must not disconnect the desktop before shutdown has finished.
  const holdQuit = (event: Electron.Event): void => event.preventDefault()
  app.prependListener('before-quit', holdQuit)
  try {
    await stopMuxForQuit()
    app.removeListener('before-quit', holdQuit)
    app.quit()
  } catch (error) {
    dialog.showErrorBox(
      'Could not quit Cerebro completely',
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    app.removeListener('before-quit', holdQuit)
    quittingCompletely = false
  }
}

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
  const completeQuit: MenuItemConstructorOptions = {
    id: 'quit-cerebro-completely',
    label: 'Quit Cerebro Completely',
    click: () => void quitCompletely()
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
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'File',
      submenu:
        process.platform === 'darwin'
          ? fileSubmenu
          : [...fileSubmenu, { type: 'separator' }, completeQuit, { role: 'quit' }]
    },
    { role: 'editMenu' },
    { label: 'View', submenu: viewSubmenu },
    { role: 'windowMenu' }
  ]

  const menu = Menu.buildFromTemplate(template)
  if (process.platform === 'darwin') {
    const appMenu = menu.items[0].submenu!
    const quitIndex = appMenu.items.findIndex((item) => item.role === 'quit')
    appMenu.insert(quitIndex < 0 ? appMenu.items.length : quitIndex, new MenuItem(completeQuit))
  }
  Menu.setApplicationMenu(menu)
}
