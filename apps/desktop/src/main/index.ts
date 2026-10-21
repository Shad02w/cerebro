import './app-environment'
import { app, shell, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { closeDb } from './db'
import { registerSettingsIpc, registerWorkspaceIpc } from './ipc'
import { log } from '@cerebro/mux'
import { getMux, disconnectMux } from './mux'
import { setAppMenu } from './menu'
import { registerNativeCommandIpc } from './native-commands'
import { ensureCerebroHome } from './paths'
import { registerCliIpc } from './cli-install'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerMediaProtocol, registerMediaScheme } from './media-protocol'
import { registerNotifications } from './notifications'
import { IPC } from '../shared/ipc'

process.on('uncaughtExceptionMonitor', (error, origin) =>
  log('error', 'desktop.crash', { origin, error })
)

// Privileged schemes must be registered before the app is ready.
registerMediaScheme()

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

  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send(IPC.native.fullScreen, true))
  mainWindow.on('leave-full-screen', () =>
    mainWindow.webContents.send(IPC.native.fullScreen, false)
  )

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
  // Packaged macOS apps use the Icon Composer catalog from the bundle.
  if (is.dev && process.platform === 'darwin') app.dock?.setIcon(icon)
  electronApp.setAppUserModelId('com.cerebro.app')
  setAppMenu()
  ipcMain.handle(
    IPC.native.fullScreen,
    (event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  )
  ensureCerebroHome()
  registerWorkspaceIpc()
  registerSettingsIpc()
  registerCliIpc()
  registerDiagnosticsIpc()
  registerNativeCommandIpc()
  registerMediaProtocol()
  registerNotifications()
  void getMux().catch((error) => console.error('[mux]', error.message))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('render-process-gone', (_event, contents, details) =>
    log('error', 'desktop.render_process_gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      url: contents.getURL().split('?')[0].slice(-100)
    })
  )
  app.on('child-process-gone', (_event, details) =>
    log('error', 'desktop.child_process_gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode
    })
  )
  log('info', 'desktop.ready', {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged
  })

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
