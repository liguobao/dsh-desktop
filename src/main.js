import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { createAutoUpdateController } from './auto-update.js'
import { DSH_RUNTIME_DIRECTORY, readActiveDshRuntime } from './dsh-runtime.js'
import { createDshUpdateController } from './dsh-update.js'
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
import { loadPluginCatalog, normalizePluginSourceUrl } from './plugin-catalog.js'
import {
  installPlugin as installProfilePlugin,
  readPluginCatalog,
  removePlugin as removeProfilePlugin,
  setPluginEnabled,
  updatePlugin as updateProfilePlugin,
} from './plugin-management.js'
import {
  createSkill,
  importSkill,
  readSkillCatalog,
  resolveManagedSkillPath,
  setSkillEnabled,
  skillDirectories,
} from './skill-management.js'
import { loadingStateScript, normalizeProgress } from './startup-progress.js'

const require = createRequire(import.meta.url)
const { autoUpdater } = electronUpdater
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
      extensions: '扩展',
      managePlugins: '插件安装',
      manageExtensions: 'Skills管理',
      pluginManager: 'DSH 插件管理',
      extensionManager: 'DSH Skills',
      dshRollback: '新版 DSH 启动失败，正在恢复内置版本…',
      dshRollbackTitle: '已恢复内置 DSH',
      dshRollbackMessage: version => `无法使用更新后的 DSH ${version}，已自动恢复 DSH Desktop 内置版本。`,
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
      extensions: 'Extensions',
      managePlugins: 'Plugin Installation',
      manageExtensions: 'Skills Management',
      pluginManager: 'DSH Plugin Manager',
      extensionManager: 'DSH Skills',
      dshRollback: 'The updated DSH failed to start. Restoring the bundled version…',
      dshRollbackTitle: 'Bundled DSH Restored',
      dshRollbackMessage: version => `DSH ${version} could not start, so DSH Desktop restored its bundled version automatically.`,
    }
}

setLocale('en')

let mainWindow
let splashWindow
let pluginWindow
let extensionWindow
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
let dshHome
let pluginOperationRunning = false
let pluginOperationController
let updateController
let updateCheckTimer
let dshRuntimeRoot
let activeDshRuntime
let dshUpdateController
let dshUpdateCheckTimer

function writeLog(source, text) {
  const prefix = `[${new Date().toISOString()}] [${source}] `
  logStream?.write(`${prefix}${text}`)
  if (!app.isPackaged) process[source === 'stderr' ? 'stderr' : 'stdout'].write(text)
}

function writeUpdaterLog(level, message) {
  writeLog(level === 'error' ? 'stderr' : 'desktop', `[updater/${level}] ${message}\n`)
}

async function prepareForUpdateInstall() {
  restartGeneration += 1
  pluginOperationController?.abort()
  dshUpdateController?.abort()
  if (updateCheckTimer !== undefined) clearTimeout(updateCheckTimer)
  if (dshUpdateCheckTimer !== undefined) clearTimeout(dshUpdateCheckTimer)
  await server?.stop()
}

function initializeAutoUpdates() {
  updateController = createAutoUpdateController({
    updater: autoUpdater,
    isPackaged: app.isPackaged,
    platform: process.platform,
    env: process.env,
    isChinese,
    currentVersion: app.getVersion(),
    dialog,
    getWindow: () => mainWindow,
    openReleasePage: url => shell.openExternal(url),
    beforeQuitAndInstall: prepareForUpdateInstall,
    onStateChange: buildMenu,
    log: writeUpdaterLog,
  })
  if (!updateController.initialize()) {
    writeUpdaterLog('info', 'Automatic updates are unavailable for this package; the Help menu links to GitHub Releases.')
    return
  }
  updateCheckTimer = setTimeout(() => {
    updateCheckTimer = undefined
    if (!quitting) void updateController.check(false)
  }, 10_000)
}

function writeDshUpdaterLog(level, message) {
  writeLog(level === 'error' ? 'stderr' : 'desktop', `[dsh-updater/${level}] ${message}\n`)
}

function initializeDshUpdates() {
  dshUpdateController = createDshUpdateController({
    initialRuntime: activeDshRuntime,
    runtimeRoot: dshRuntimeRoot,
    pnpmEntry: resolvePnpmEntry(),
    execPath: process.execPath,
    env: process.env,
    isChinese,
    dialog,
    getWindow: () => mainWindow,
    onRuntimeChanged: async runtime => {
      activeDshRuntime = runtime
      writeDshUpdaterLog('info', `Switching to DSH ${runtime.version} from the ${runtime.source} runtime.`)
      await startHarness(copy.restarting)
    },
    onStateChange: buildMenu,
    onOutput: writeLog,
    log: writeDshUpdaterLog,
    isOperationBlocked: () => pluginOperationRunning,
  })
  dshUpdateCheckTimer = setTimeout(() => {
    dshUpdateCheckTimer = undefined
    if (!quitting) void dshUpdateController.check(false)
  }, 30_000)
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

function senderIsPluginManager(event) {
  if (pluginWindow?.isDestroyed() !== false || event.sender !== pluginWindow.webContents) return false
  try {
    return fileURLToPath(event.senderFrame?.url ?? event.sender.getURL()) === pagePath('plugins.html')
  } catch {
    return false
  }
}

function senderIsExtensionManager(event) {
  if (extensionWindow?.isDestroyed() !== false || event.sender !== extensionWindow.webContents) return false
  try {
    return fileURLToPath(event.senderFrame?.url ?? event.sender.getURL()) === pagePath('extensions.html')
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
  ipcMain.handle('dsh-desktop:plugins-list', (event) => {
    if (!senderIsPluginManager(event) || dshHome === undefined) return { ok: false, error: 'Untrusted plugin request' }
    try {
      return { ok: true, catalog: readPluginCatalog({ dshHome }) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('dsh-desktop:plugins-discover', async (event) => {
    if (!senderIsPluginManager(event)) return { ok: false, error: 'Untrusted plugin request' }
    try {
      return { ok: true, ...await loadPluginCatalog() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('dsh-desktop:plugins-install', (event, spec, allowBuildScripts = false) => {
    if (!senderIsPluginManager(event)) return { ok: false, error: 'Untrusted plugin request' }
    return runPluginOperation(signal => installProfilePlugin({
      dshHome,
      pnpmEntry: resolvePnpmEntry(),
      spec,
      allowBuildScripts,
      onOutput: writeLog,
      signal,
    }))
  })
  ipcMain.handle('dsh-desktop:plugins-enabled', (event, name, enabled) => {
    if (!senderIsPluginManager(event) || typeof enabled !== 'boolean') {
      return { ok: false, error: 'Untrusted plugin request' }
    }
    return runPluginOperation(async () => {
      setPluginEnabled({ dshHome, name, enabled })
      return readPluginCatalog({ dshHome })
    })
  })
  ipcMain.handle('dsh-desktop:plugins-update', (event, name) => {
    if (!senderIsPluginManager(event)) return { ok: false, error: 'Untrusted plugin request' }
    return runPluginOperation(signal => updateProfilePlugin({
      dshHome,
      pnpmEntry: resolvePnpmEntry(),
      name,
      onOutput: writeLog,
      signal,
    }))
  })
  ipcMain.handle('dsh-desktop:plugins-remove', (event, name) => {
    if (!senderIsPluginManager(event)) return { ok: false, error: 'Untrusted plugin request' }
    return runPluginOperation(signal => removeProfilePlugin({
      dshHome,
      pnpmEntry: resolvePnpmEntry(),
      name,
      onOutput: writeLog,
      signal,
    }))
  })
  ipcMain.handle('dsh-desktop:plugins-restart', (event) => {
    if (!senderIsPluginManager(event)) return { ok: false, error: 'Untrusted plugin request' }
    void startHarness(copy.restarting)
    return { ok: true }
  })
  ipcMain.handle('dsh-desktop:plugins-docs', (event) => {
    if (!senderIsPluginManager(event)) return { ok: false, error: 'Untrusted plugin request' }
    void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md#profiles')
    return { ok: true }
  })
  ipcMain.handle('dsh-desktop:plugins-source', (event, url) => {
    if (!senderIsPluginManager(event)) return { ok: false, error: 'Untrusted plugin request' }
    try {
      void shell.openExternal(normalizePluginSourceUrl(url))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('dsh-desktop:skills-list', (event) => {
    if (!senderIsExtensionManager(event) || dshHome === undefined) return { ok: false, error: 'Untrusted skill request' }
    try {
      return { ok: true, catalog: readSkillCatalog({ dshHome }) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('dsh-desktop:skills-create', (event, name, description) => {
    if (!senderIsExtensionManager(event)) return { ok: false, error: 'Untrusted skill request' }
    return runPluginOperation(async () => createSkill({ dshHome, name, description }))
  })
  ipcMain.handle('dsh-desktop:skills-import', async (event) => {
    if (!senderIsExtensionManager(event) || extensionWindow?.isDestroyed() !== false) {
      return { ok: false, error: 'Untrusted skill request' }
    }
    const selection = await dialog.showOpenDialog(extensionWindow, {
      title: isChinese ? '选择包含 SKILL.md 的文件夹' : 'Choose a folder containing SKILL.md',
      properties: ['openDirectory'],
    })
    if (selection.canceled || selection.filePaths.length !== 1) {
      return { ok: true, cancelled: true, catalog: readSkillCatalog({ dshHome }) }
    }
    return runPluginOperation(async () => importSkill({ dshHome, sourcePath: selection.filePaths[0] }))
  })
  ipcMain.handle('dsh-desktop:skills-enabled', (event, entry, enabled) => {
    if (!senderIsExtensionManager(event) || typeof enabled !== 'boolean') {
      return { ok: false, error: 'Untrusted skill request' }
    }
    return runPluginOperation(async () => setSkillEnabled({ dshHome, entry, enabled }))
  })
  ipcMain.handle('dsh-desktop:skills-reveal', (event, entry, enabled) => {
    if (!senderIsExtensionManager(event)) return { ok: false, error: 'Untrusted skill request' }
    try {
      shell.showItemInFolder(resolveManagedSkillPath({ dshHome, entry, enabled }))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('dsh-desktop:skills-remove', (event, entry, enabled) => {
    if (!senderIsExtensionManager(event)) return { ok: false, error: 'Untrusted skill request' }
    return runPluginOperation(async () => {
      await shell.trashItem(resolveManagedSkillPath({ dshHome, entry, enabled }))
      return readSkillCatalog({ dshHome })
    })
  })
  ipcMain.handle('dsh-desktop:skills-open-root', async (event) => {
    if (!senderIsExtensionManager(event) || dshHome === undefined) return { ok: false, error: 'Untrusted skill request' }
    try {
      const { activeDir } = skillDirectories(dshHome)
      mkdirSync(activeDir, { recursive: true, mode: 0o700 })
      await openSystemPath(activeDir)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('dsh-desktop:skills-docs', (event) => {
    if (!senderIsExtensionManager(event)) return { ok: false, error: 'Untrusted skill request' }
    const document = isChinese ? 'README.zh.md' : 'README.md'
    void shell.openExternal(`https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/${document}`)
    return { ok: true }
  })
}

async function runPluginOperation(action) {
  if (dshHome === undefined) return { ok: false, error: 'Harness home is unavailable' }
  if (pluginOperationRunning || (dshUpdateController !== undefined && dshUpdateController.state !== 'idle')) {
    return { ok: false, error: 'Another extension or DSH operation is already running' }
  }
  pluginOperationRunning = true
  const controller = new AbortController()
  pluginOperationController = controller
  try {
    const catalog = await action(controller.signal)
    return { ok: true, catalog }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    writeLog('stderr', `Extension operation failed: ${detail}\n`)
    return { ok: false, error: detail }
  } finally {
    if (pluginOperationController === controller) pluginOperationController = undefined
    pluginOperationRunning = false
  }
}

function clearWorkspaceContext() {
  if (activeWorkspace === undefined && workspaceRoots.length === 0) return
  activeWorkspace = undefined
  workspaceRoots = []
  buildMenu()
}

function resolveBundledDshManifest() {
  return require.resolve('@deepseek-ai/dsh/package.json')
}

function resolveDshEntry() {
  if (activeDshRuntime === undefined) {
    const manifest = resolveBundledDshManifest()
    const entry = join(dirname(manifest), 'lib', 'bin.js')
    if (!existsSync(entry)) throw new Error(`DeepSeek Harness entry point is missing: ${entry}`)
    return entry
  }
  return activeDshRuntime.entry
}

function resolvePnpmEntry() {
  const manifest = require.resolve('pnpm')
  const entry = join(dirname(manifest), 'bin', 'pnpm.mjs')
  if (!existsSync(entry)) throw new Error(`Bundled pnpm entry point is missing: ${entry}`)
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
  window.on('closed', () => {
    mainWindow = undefined
    if (pluginWindow?.isDestroyed() === false) pluginWindow.close()
    if (extensionWindow?.isDestroyed() === false) extensionWindow.close()
  })
  return window
}

function createManagerWindow({ page, preload, title }) {
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title,
    icon: join(import.meta.dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#f4f7fc',
    webPreferences: {
      preload: join(import.meta.dirname, preload),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (fileURLToPath(url) === pagePath(page)) return
    } catch {
      // Reject non-file and malformed navigation below.
    }
    event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  return window
}

function focusManagerWindow(window) {
  if (window?.isDestroyed() !== false) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}

function showPluginManager() {
  if (focusManagerWindow(pluginWindow)) return
  pluginWindow = createManagerWindow({ page: 'plugins.html', preload: 'plugin-preload.cjs', title: copy.pluginManager })
  const window = pluginWindow
  window.on('closed', () => {
    if (pluginWindow === window) pluginWindow = undefined
  })
  void pluginWindow.loadFile(pagePath('plugins.html'), {
    query: { lang: isChinese ? 'zh' : 'en' },
  })
}

function showExtensionManager() {
  if (focusManagerWindow(extensionWindow)) return
  extensionWindow = createManagerWindow({ page: 'extensions.html', preload: 'extension-preload.cjs', title: copy.extensionManager })
  const window = extensionWindow
  window.on('closed', () => {
    if (extensionWindow === window) extensionWindow = undefined
  })
  void extensionWindow.loadFile(pagePath('extensions.html'), {
    query: { lang: isChinese ? 'zh' : 'en' },
  })
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
    return true
  } catch (error) {
    if (generation === restartGeneration) {
      await server?.stop()
      if (dshUpdateController?.useBundledFallback()) {
        const failedVersion = activeDshRuntime?.version ?? 'unknown'
        activeDshRuntime = dshUpdateController.runtime
        writeDshUpdaterLog('error', `DSH ${failedVersion} failed to start; falling back to bundled ${activeDshRuntime.version}.`)
        const restored = await startHarness(copy.dshRollback)
        if (restored && mainWindow?.isDestroyed() === false) {
          void dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: copy.dshRollbackTitle,
            message: copy.dshRollbackMessage(failedVersion),
          })
        }
        return false
      }
      await showError(copy.startupFailed, error)
    }
    return false
  }
}

function buildMenu() {
  const editor = selectedDesktopEditor()
  const updateItem = updateController?.menuItem()
  const dshUpdateItem = dshUpdateController?.menuItem()
  const dshRestoreItem = dshUpdateController?.restoreItem()
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
      label: copy.extensions,
      submenu: [
        { label: copy.managePlugins, click: showPluginManager },
        { label: copy.manageExtensions, click: showExtensionManager },
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
        ...(updateItem === undefined ? [] : [{
          label: updateItem.label,
          enabled: updateItem.enabled,
          click: () => void updateController.check(true),
        }, { type: 'separator' }]),
        ...(dshUpdateItem === undefined ? [] : [{
          label: dshUpdateItem.label,
          enabled: dshUpdateItem.enabled,
          click: () => void dshUpdateController.check(true),
        }]),
        ...(dshRestoreItem === undefined ? [] : [{
          label: dshRestoreItem.label,
          enabled: dshRestoreItem.enabled,
          click: () => void dshUpdateController.restoreBundled(),
        }]),
        ...(dshUpdateItem === undefined ? [] : [{ type: 'separator' }]),
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
    dshRuntimeRoot = join(app.getPath('userData'), DSH_RUNTIME_DIRECTORY)
    activeDshRuntime = readActiveDshRuntime({
      runtimeRoot: dshRuntimeRoot,
      bundledManifestPath: resolveBundledDshManifest(),
    })
    if (activeDshRuntime.managedError !== undefined) {
      writeDshUpdaterLog('error', `Ignoring invalid managed DSH runtime: ${activeDshRuntime.managedError}`)
    }
    writeDshUpdaterLog('info', `Using DSH ${activeDshRuntime.version} from the ${activeDshRuntime.source} runtime.`)
    dshHome = resolveHarnessHome(process.env, app.getPath('home'), app.getPath('home'))
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
    initializeAutoUpdates()
    initializeDshUpdates()
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
    pluginOperationController?.abort()
    dshUpdateController?.abort()
    if (updateCheckTimer !== undefined) clearTimeout(updateCheckTimer)
    if (dshUpdateCheckTimer !== undefined) clearTimeout(dshUpdateCheckTimer)
    void Promise.resolve(server?.stop()).finally(() => {
      logStream?.end()
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
