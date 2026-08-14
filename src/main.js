import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { HarnessServer } from './harness-server.js'
import { isExternalHttpUrl, isHarnessUrl } from './navigation.js'
import { loadingStateScript, normalizeProgress } from './startup-progress.js'

const require = createRequire(import.meta.url)
let isChinese = false
let copy

function setLocale(locale) {
  isChinese = locale.toLowerCase().startsWith('zh')
  copy = isChinese ? {
      preparing: '正在准备桌面窗口…',
      loading: '正在启动 DeepSeek Harness…',
      loadingServices: '正在加载本地服务…',
      openingWorkspace: '正在打开工作区…',
      ready: '准备就绪',
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
      preparing: 'Preparing the desktop window…',
      loading: 'Starting DeepSeek Harness…',
      loadingServices: 'Loading local services…',
      openingWorkspace: 'Opening the workspace…',
      ready: 'Ready',
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
let splashWindow
let server
let harnessOrigin
let quitting = false
let restartGeneration = 0
let loadingProgress = 0
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

function currentLoadingWindow() {
  if (splashWindow?.isDestroyed() === false) return splashWindow
  if (mainWindow?.isDestroyed() === false) return mainWindow
  return undefined
}

async function showLoading(message = copy.preparing, progress = 8, generation = restartGeneration) {
  const window = currentLoadingWindow()
  if (window === undefined) return
  harnessOrigin = undefined
  await window.loadFile(pagePath('loading.html'), {
    query: { lang: isChinese ? 'zh' : 'en', message, progress: String(progress) },
  })
  if (generation !== restartGeneration || window.isDestroyed()) return
  loadingProgress = normalizeProgress(progress)
  if (!window.isVisible()) window.show()
}

async function updateLoading(message, progress, stage, generation = restartGeneration) {
  const window = currentLoadingWindow()
  const nextProgress = normalizeProgress(progress)
  if (window === undefined || generation !== restartGeneration || nextProgress < loadingProgress) return
  loadingProgress = nextProgress
  writeLog('desktop', `Startup stage ${stage} (${String(nextProgress)}%).\n`)
  try {
    await window.webContents.executeJavaScript(loadingStateScript(message, nextProgress), true)
  } catch (error) {
    if (!window.isDestroyed()) writeLog('stderr', `Unable to update startup progress: ${String(error)}\n`)
  }
}

function revealMainWindow() {
  if (mainWindow?.isDestroyed() !== false) return
  mainWindow.show()
  const splash = splashWindow
  splashWindow = undefined
  if (splash?.isDestroyed() === false) splash.close()
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
  revealMainWindow()
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
  window.on('closed', () => { mainWindow = undefined })
  return window
}

function createSplashWindow() {
  const window = new BrowserWindow({
    width: 520,
    height: 420,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'DSH Desktop',
    icon: join(import.meta.dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#f4f7fc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  window.on('closed', () => {
    if (splashWindow === window) splashWindow = undefined
    if (!quitting && mainWindow?.isVisible() !== true) app.quit()
  })
  return window
}

async function startHarness(message = copy.preparing) {
  const startedAt = performance.now()
  const generation = ++restartGeneration
  await showLoading(message, 8, generation)
  if (mainWindow === undefined) mainWindow = createWindow()
  await updateLoading(copy.loading, 24, 'launching-harness', generation)
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
      onOutput: (() => {
        let receivedOutput = false
        return (source, text) => {
          writeLog(source, text)
          if (receivedOutput) return
          receivedOutput = true
          void updateLoading(copy.loadingServices, 56, 'loading-services', generation)
        }
      })(),
    })
    server = nextServer
    nextServer.on('exit', ({ code, signal, ready }) => {
      writeLog('desktop', `Harness exited (code=${String(code)}, signal=${String(signal)}).\n`)
      if (ready && !quitting && server === nextServer && generation === restartGeneration) {
        void showError(copy.stopped, `Exit code: ${String(code)}, signal: ${String(signal)}`)
      }
    })
    const url = await nextServer.start()
    await updateLoading(copy.openingWorkspace, 82, 'harness-ready', generation)
    if (generation !== restartGeneration || quitting || mainWindow?.isDestroyed() !== false) {
      await nextServer.stop()
      return
    }
    harnessOrigin = new URL(url).origin
    await updateLoading(copy.openingWorkspace, 92, 'loading-workspace', generation)
    await mainWindow.loadURL(url)
    await updateLoading(copy.ready, 100, 'complete', generation)
    writeLog('desktop', `Startup completed in ${String(Math.round(performance.now() - startedAt))} ms.\n`)
    revealMainWindow()
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
    splashWindow = createSplashWindow()
    void startHarness()
  }).catch((error) => {
    dialog.showErrorBox(copy.startupFailed, error instanceof Error ? error.stack ?? error.message : String(error))
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      splashWindow = createSplashWindow()
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
