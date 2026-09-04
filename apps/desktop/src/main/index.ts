import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { closeDb } from './db'
import { registerSettingsIpc, registerWorkspaceIpc } from './ipc'
import { startSocketServer, stopSocketServer } from './ipc-socket'
import { setAppMenu } from './menu'
import { ensureCerebroHome } from './paths'
import { clearActiveWorkspace } from './projects'
import { killAllPtys } from './pty'

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
    // Keep in sync with TRAFFIC_LIGHT_Y / WindowDragOverlay in the renderer.
    trafficLightPosition: { x: 16, y: 16 },
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: '#0a0a0a',
            symbolColor: '#fafafa',
            height: 40
          }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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
  electronApp.setAppUserModelId('com.cerebro.app')
  setAppMenu()
  ensureCerebroHome()
  clearActiveWorkspace()
  registerWorkspaceIpc()
  registerSettingsIpc()
  startSocketServer()

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

app.on('before-quit', () => {
  stopSocketServer()
  killAllPtys()
  closeDb()
})
