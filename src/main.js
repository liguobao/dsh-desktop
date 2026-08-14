import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import {
  authorizeWorkspacePath,
  detectEditors,
  installDesktopPlugin,
  isTextLikePath,
  launchEditor,
  normalizeEditorPreference,
  normalizeWorkspaceContext,
  readDesktopSettings,
  resolveHarnessHome,
  selectedEditor,
  writeDesktopSettings,
} from './desktop-integration.js'
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
      workspace: '工作区',
      openWorkspaceInEditor: '在编辑器中打开工作区',
      openWorkspaceFolder: '在文件管理器中打开',
      preferredEditor: '首选编辑器',
      automaticEditor: '自动选择',
      noEditor: '未检测到受支持的编辑器',
      nativeOpenFailed: '无法打开本地路径',
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
      workspace: 'Workspace',
      openWorkspaceInEditor: 'Open Workspace in Editor',
      openWorkspaceFolder: 'Open in File Manager',
      preferredEditor: 'Preferred Editor',
      automaticEditor: 'Automatic',
      noEditor: 'No supported editor detected',
      nativeOpenFailed: 'Could Not Open Local Path',
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
let activeWorkspace
let workspaceRoots = []
let editors = []
let editorPreference = 'auto'
let desktopSettingsPath
let desktopIpcInstalled = false

function writeLog(source, text) {
  const prefix = `[${new Date().toISOString()}] [${source}] `
  logStream?.write(`${prefix}${text}`)
  if (!app.isPackaged) process[source === 'stderr' ? 'stderr' : 'stdout'].write(text)
}

function selectedDesktopEditor() {
  return selectedEditor(editors, editorPreference)
}

function senderIsHarness(event) {
  if (harnessOrigin === undefined || mainWindow?.isDestroyed() !== false) return false
  if (event.sender !== mainWindow.webContents) return false
  try {
    return new URL(event.senderFrame?.url ?? event.sender.getURL()).origin === harnessOrigin
  } catch {
    return false
  }
}

async function openSystemPath(path) {
  const error = await shell.openPath(path)
  if (error !== '') throw new Error(error)
}

async function openDesktopPath(path, intent = 'auto') {
  const target = authorizeWorkspacePath(path, workspaceRoots)
  const stats = statSync(target)
  const editor = selectedDesktopEditor()
  const useEditor = intent === 'editor' || (intent === 'auto' && stats.isFile() && isTextLikePath(target))

  if (useEditor) {
    if (editor === undefined) {
      if (intent === 'editor') throw new Error(copy.noEditor)
    } else {
      await launchEditor(editor, target)
      return
    }
  }
  await openSystemPath(target)
}

async function reportDesktopAction(action) {
  try {
    await action()
    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    writeLog('stderr', `${copy.nativeOpenFailed}: ${detail}\n`)
    if (mainWindow?.isDestroyed() === false) {
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: copy.nativeOpenFailed,
        message: copy.nativeOpenFailed,
        detail,
      })
    }
    return { ok: false, error: detail }
  }
}

function saveEditorPreference(preference) {
  editorPreference = normalizeEditorPreference(preference, editors)
  if (desktopSettingsPath !== undefined) {
    writeDesktopSettings(desktopSettingsPath, { editor: editorPreference })
  }
  buildMenu()
}

function installDesktopIpc() {
  if (desktopIpcInstalled) return
  desktopIpcInstalled = true
  ipcMain.handle('dsh-desktop:open-path', (event, path, intent = 'auto') => {
    if (!senderIsHarness(event)) return { ok: false, error: 'Untrusted path-open request' }
    if (!['auto', 'editor', 'default'].includes(intent)) return { ok: false, error: 'Invalid path-open intent' }
    return reportDesktopAction(() => openDesktopPath(path, intent))
  })
  ipcMain.on('dsh-desktop:workspace-context', (event, value) => {
    if (!senderIsHarness(event)) return
    const next = normalizeWorkspaceContext(value)
    const activeChanged = next.active !== activeWorkspace
    activeWorkspace = next.active
    workspaceRoots = next.roots
    if (activeChanged) buildMenu()
  })
}

function clearWorkspaceContext() {
  if (activeWorkspace === undefined && workspaceRoots.length === 0) return
  activeWorkspace = undefined
  workspaceRoots = []
  buildMenu()
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
  clearWorkspaceContext()
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
  clearWorkspaceContext()
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
      preload: join(import.meta.dirname, 'preload.cjs'),
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
        '--patch',
        join(import.meta.dirname, 'dsh-desktop.patch.yml'),
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
  const editor = selectedDesktopEditor()
  const editorItems = editors.length === 0
    ? [{ label: copy.noEditor, enabled: false }]
    : [
        {
          label: editor === undefined ? copy.automaticEditor : `${copy.automaticEditor} (${editor.label})`,
          type: 'radio',
          checked: editorPreference === 'auto',
          click: () => saveEditorPreference('auto'),
        },
        { type: 'separator' },
        ...editors.map(candidate => ({
          label: candidate.label,
          type: 'radio',
          checked: editorPreference === candidate.id,
          click: () => saveEditorPreference(candidate.id),
        })),
      ]
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: copy.workspace,
      submenu: [
        {
          label: copy.openWorkspaceInEditor,
          accelerator: 'CmdOrCtrl+Shift+O',
          enabled: activeWorkspace !== undefined && editor !== undefined,
          click: () => {
            if (activeWorkspace !== undefined) void reportDesktopAction(() => openDesktopPath(activeWorkspace, 'editor'))
          },
        },
        {
          label: copy.openWorkspaceFolder,
          enabled: activeWorkspace !== undefined,
          click: () => {
            if (activeWorkspace !== undefined) void reportDesktopAction(() => openDesktopPath(activeWorkspace, 'default'))
          },
        },
        { type: 'separator' },
        { label: copy.preferredEditor, submenu: editorItems },
      ],
    },
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
    const dshHome = resolveHarnessHome(process.env, app.getPath('home'), app.getPath('home'))
    const installedPlugin = installDesktopPlugin({
      sourceDir: join(import.meta.dirname, 'plugins', 'dsh-desktop-integration'),
      dshHome,
    })
    writeLog('desktop', `Desktop integration plugin installed at ${installedPlugin}.\n`)
    editors = detectEditors()
    desktopSettingsPath = join(app.getPath('userData'), 'desktop-settings.json')
    editorPreference = normalizeEditorPreference(readDesktopSettings(desktopSettingsPath).editor, editors)
    writeLog('desktop', `Detected editors: ${editors.map(editor => editor.id).join(', ') || 'none'}.\n`)
    installDesktopIpc()
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
