import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { HarnessServer } from './harness-server.js'
import { isExternalHttpUrl, isHarnessUrl } from './navigation.js'

const require = createRequire(import.meta.url)
let isChinese = false
let copy

function setLocale(locale) {
  isChinese = locale.toLowerCase().startsWith('zh')
  copy = isChinese ? {
      loading: '正在启动 DeepSeek Harness…',
      restarting: '正在重启 DeepSeek Harness…',
      startupFailed: 'DeepSeek Harness 启动失败',
      stopped: 'DeepSeek Harness 已停止',
      openLogs: '打开日志目录',
      retry: '重启 Harness',
      view: '视图',
      reload: '重新加载',
      actualSize: '实际大小',
      zoomIn: '放大',
      zoomOut: '缩小',
      window: '窗口',
    } : {
      loading: 'Starting DeepSeek Harness…',
      restarting: 'Restarting DeepSeek Harness…',
      startupFailed: 'DeepSeek Harness failed to start',
      stopped: 'DeepSeek Harness stopped',
      openLogs: 'Open Logs Folder',
      retry: 'Restart Harness',
      view: 'View',
      reload: 'Reload',
      actualSize: 'Actual Size',
      zoomIn: 'Zoom In',
      zoomOut: 'Zoom Out',
      window: 'Window',
    }
}

setLocale('en')

let mainWindow
let server
let harnessOrigin
let quitting = false
let restartGeneration = 0
let logStream
let logPath

function writeLog(source, text) {
  const prefix = `[${new Date().toISOString()}] [${source}] `
  logStream?.write(`${prefix}${text}`)
  if (!app.isPackaged) process[source === 'stderr' ? 'stderr' : 'stdout'].write(text)
}

function resolveDshEntry() {
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  const entry = join(dirname(manifest), 'lib', 'bin.js')
  if (!existsSync(entry)) throw new Error(`DeepSeek Harness entry point is missing: ${entry}`)
  return entry
}

function pagePath(name) {
  return join(import.meta.dirname, 'pages', name)
}

function isDesktopPage(url) {
  try {
    if (new URL(url).protocol !== 'file:') return false
    const path = fileURLToPath(url)
    return path === pagePath('loading.html') || path === pagePath('error.html')
  } catch {
    return false
  }
}

async function showLoading(message = copy.loading) {
  if (mainWindow?.isDestroyed() !== false) return
  harnessOrigin = undefined
  await mainWindow.loadFile(pagePath('loading.html'), {
    query: { lang: isChinese ? 'zh' : 'en', message },
  })
}

async function showError(title, error) {
  if (mainWindow?.isDestroyed() !== false || quitting) return
  harnessOrigin = undefined
  const detail = error instanceof Error ? error.message : String(error)
  writeLog('desktop', `${title}: ${detail}\n`)
  await mainWindow.loadFile(pagePath('error.html'), {
    query: {
      lang: isChinese ? 'zh' : 'en',
      title,
      detail,
      logs: logPath ?? '',
    },
  })
}

function installNavigationPolicy(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHarnessUrl(url, harnessOrigin)) void window.loadURL(url)
    else if (isExternalHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isDesktopPage(url) || isHarnessUrl(url, harnessOrigin)) return
    event.preventDefault()
    if (isExternalHttpUrl(url)) void shell.openExternal(url)
  })

  window.webContents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    permission === 'clipboard-sanitized-write' && requestingOrigin === harnessOrigin,
  )
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    try {
      const requestingOrigin = new URL(webContents.getURL()).origin
      callback(permission === 'clipboard-sanitized-write' && requestingOrigin === harnessOrigin)
    } catch {
      callback(false)
    }
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 840,
    minHeight: 600,
    show: false,
    title: 'DSH Desktop',
    icon: join(import.meta.dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#f6f8fc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  installNavigationPolicy(window)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { mainWindow = undefined })
  return window
}

async function startHarness(message = copy.loading) {
  const generation = ++restartGeneration
  await showLoading(message)
  if (server !== undefined) await server.stop()
  if (generation !== restartGeneration || quitting) return

  try {
    const nextServer = new HarnessServer({
      command: process.execPath,
      // Cordis HMR uses Node internals even in production. Electron's embedded
      // Node keeps them behind the same explicit switch as upstream Node.
      // The preload watches the otherwise-unused stdin pipe so an abrupt
      // desktop-parent exit still asks dsh to shut down.
      args: [
        '--expose-internals',
        '--require',
        join(import.meta.dirname, 'parent-watch.cjs'),
        resolveDshEntry(),
        'web',
        '--port',
        '0',
      ],
      cwd: app.getPath('home'),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_DESKTOP: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      onOutput: writeLog,
    })
    server = nextServer
    nextServer.on('exit', ({ code, signal, ready }) => {
      writeLog('desktop', `Harness exited (code=${String(code)}, signal=${String(signal)}).\n`)
      if (ready && !quitting && server === nextServer && generation === restartGeneration) {
        void showError(copy.stopped, `Exit code: ${String(code)}, signal: ${String(signal)}`)
      }
    })
    const url = await nextServer.start()
    if (generation !== restartGeneration || quitting || mainWindow?.isDestroyed() !== false) {
      await nextServer.stop()
      return
    }
    harnessOrigin = new URL(url).origin
    await mainWindow.loadURL(url)
  } catch (error) {
    if (generation === restartGeneration) {
      await server?.stop()
      await showError(copy.startupFailed, error)
    }
  }
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: copy.view,
      submenu: [
        { label: copy.reload, accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { label: copy.retry, click: () => void startHarness(copy.restarting) },
        { type: 'separator' },
        { role: 'resetZoom', label: copy.actualSize },
        { role: 'zoomIn', label: copy.zoomIn },
        { role: 'zoomOut', label: copy.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: copy.window,
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: copy.openLogs, click: () => { if (logPath !== undefined) void shell.openPath(dirname(logPath)) } },
        { label: 'DeepSeek Harness', click: () => void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    app.setName('DSH Desktop')
    setLocale(app.getLocale())
    const logsDirectory = join(app.getPath('userData'), 'logs')
    mkdirSync(logsDirectory, { recursive: true })
    logPath = join(logsDirectory, 'desktop.log')
    logStream = createWriteStream(logPath, { flags: 'a' })
    writeLog('desktop', `DSH Desktop ${app.getVersion()} starting on ${process.platform}/${process.arch}.\n`)
    buildMenu()
    mainWindow = createWindow()
    void startHarness()
  }).catch((error) => {
    dialog.showErrorBox(copy.startupFailed, error instanceof Error ? error.stack ?? error.message : String(error))
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      void startHarness()
    }
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    restartGeneration += 1
    void Promise.resolve(server?.stop()).finally(() => {
      logStream?.end()
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
