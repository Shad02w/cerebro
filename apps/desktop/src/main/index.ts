import { appIdentity } from './app-identity'
import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { closeDb } from './db'
import { registerSettingsIpc, registerWorkspaceIpc } from './ipc'
import { getMux, disconnectMux } from './mux'
import { setAppMenu } from './menu'
import { registerNativeCommandIpc } from './native-commands'
import { ensureCerebroHome } from './paths'
import { registerCliIpc } from './cli-install'
import { IPC } from '../shared/ipc'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Cerebro',
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    // Keep in sync with TRAFFIC_LIGHT_Y / TITLEBAR_HEIGHT in renderer src/lib/titlebar.ts.
    trafficLightPosition: { x: 16, y: 16 },
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: '#0a0a0a',
            symbolColor: '#fafafa',
            height: 44
          }
        }
      : {}),
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep Query's background refresh interval active while the window is hidden.
      backgroundThrottling: false
    }
  })

  mainWindow.on('focus', () => mainWindow.webContents.send(IPC.native.focus, true))
  mainWindow.on('blur', () => mainWindow.webContents.send(IPC.native.focus, false))

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (process.env.NODE_ENV !== 'test') void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  if (process.platform === 'darwin') app.dock?.setIcon(icon)
  electronApp.setAppUserModelId(appIdentity.appId)
  setAppMenu()
  ensureCerebroHome()
  registerWorkspaceIpc()
  registerSettingsIpc()
  registerCliIpc()
  registerNativeCommandIpc()
  void getMux().catch((error) => console.error('[mux]', error.message))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (event.defaultPrevented) return
  disconnectMux()
  closeDb()
})
