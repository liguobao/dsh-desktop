const RELEASES_URL = 'https://github.com/liguobao/dsh-desktop/releases/latest'

function updateCopy(isChinese) {
  return isChinese ? {
      check: '检查更新…',
      checking: '正在检查更新…',
      downloading: progress => `正在下载更新… ${String(progress)}%`,
      available: version => `可更新至 v${version}`,
      restart: '重启以完成更新',
      installing: '正在安装更新…',
      releases: '查看最新版本…',
      availableTitle: '发现新版本',
      availableMessage: version => `DSH Desktop ${version} 已发布`,
      availableDetail: current => `当前版本为 ${current}。是否立即下载更新？`,
      download: '下载更新',
      later: '稍后',
      readyTitle: '更新已准备好',
      readyMessage: version => `DSH Desktop ${version} 已下载完成`,
      readyDetail: '重启应用后将自动安装。',
      restartNow: '立即重启',
      noUpdateTitle: '已是最新版本',
      noUpdateMessage: version => `DSH Desktop ${version} 已是最新版本。`,
      failedTitle: '更新失败',
      failedMessage: '无法完成在线更新。',
    } : {
      check: 'Check for Updates…',
      checking: 'Checking for Updates…',
      downloading: progress => `Downloading Update… ${String(progress)}%`,
      available: version => `Update to v${version}`,
      restart: 'Restart to Finish Update',
      installing: 'Installing Update…',
      releases: 'View Latest Release…',
      availableTitle: 'Update Available',
      availableMessage: version => `DSH Desktop ${version} is available`,
      availableDetail: current => `You are using ${current}. Download the update now?`,
      download: 'Download Update',
      later: 'Later',
      readyTitle: 'Update Ready',
      readyMessage: version => `DSH Desktop ${version} has been downloaded`,
      readyDetail: 'Restart the application to install it.',
      restartNow: 'Restart Now',
      noUpdateTitle: 'You’re Up to Date',
      noUpdateMessage: version => `DSH Desktop ${version} is the latest version.`,
      failedTitle: 'Update Failed',
      failedMessage: 'The online update could not be completed.',
    }
}

export function supportsAutomaticUpdates({ isPackaged, platform, env = {} }) {
  if (!isPackaged || !['darwin', 'linux', 'win32'].includes(platform)) return false
  if (platform === 'win32' && env.PORTABLE_EXECUTABLE_FILE) return false
  if (platform === 'linux' && !env.APPIMAGE) return false
  return true
}

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error)
}

function updaterLogger(log) {
  return Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, (...values) => {
    log(level, values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '))
  }]))
}

export function createAutoUpdateController({
  updater,
  isPackaged,
  platform,
  env,
  isChinese,
  currentVersion,
  dialog,
  getWindow,
  openReleasePage,
  beforeQuitAndInstall,
  onStateChange = () => {},
  log = () => {},
}) {
  const copy = updateCopy(isChinese)
  const supported = supportsAutomaticUpdates({ isPackaged, platform, env })
  let state = supported ? 'idle' : 'unsupported'
  let progress = 0
  let targetVersion
  let initialized = false
  let manualCheck = false
  let interactiveFlow = false
  let availablePromptOpen = false
  let installPromptOpen = false
  const handledErrors = new WeakSet()

  function setState(next, details = {}) {
    state = next
    if (details.progress !== undefined) progress = details.progress
    if (details.version !== undefined) targetVersion = details.version
    onStateChange()
  }

  function menuItem() {
    if (!supported) return { label: copy.releases, enabled: true }
    if (state === 'checking') return { label: copy.checking, enabled: false }
    if (state === 'downloading') return { label: copy.downloading(progress), enabled: false }
    if (state === 'available') return { label: copy.available(targetVersion), enabled: false }
    if (state === 'downloaded') return { label: copy.restart, enabled: true }
    if (state === 'installing') return { label: copy.installing, enabled: false }
    return { label: copy.check, enabled: true }
  }

  function showMessage(options) {
    const window = getWindow()
    return window?.isDestroyed?.() === false
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)
  }

  async function showFailure(error, shouldNotify) {
    const detail = errorDetail(error)
    log('error', `Update failed: ${detail}`)
    manualCheck = false
    interactiveFlow = false
    setState('idle', { progress: 0 })
    if (shouldNotify) {
      await showMessage({
        type: 'error',
        title: copy.failedTitle,
        message: copy.failedMessage,
        detail,
      })
    }
  }

  async function promptInstall(info = {}) {
    if (installPromptOpen || state !== 'downloaded') return
    installPromptOpen = true
    try {
      const version = info.version ?? targetVersion ?? currentVersion
      const result = await showMessage({
        type: 'info',
        title: copy.readyTitle,
        message: copy.readyMessage(version),
        detail: copy.readyDetail,
        buttons: [copy.restartNow, copy.later],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (result.response !== 0) return
      setState('installing')
      await beforeQuitAndInstall()
      updater.quitAndInstall(false, true)
    } catch (error) {
      await showFailure(error, true)
    } finally {
      installPromptOpen = false
    }
  }

  async function handleAvailable(info = {}) {
    if (availablePromptOpen) return
    availablePromptOpen = true
    manualCheck = false
    const version = info.version ?? currentVersion
    setState('available', { version })
    try {
      const result = await showMessage({
        type: 'info',
        title: copy.availableTitle,
        message: copy.availableMessage(version),
        detail: copy.availableDetail(currentVersion),
        buttons: [copy.download, copy.later],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (result.response !== 0) {
        setState('idle', { progress: 0 })
        return
      }
      interactiveFlow = true
      setState('downloading', { progress: 0 })
      try {
        await updater.downloadUpdate()
      } catch (error) {
        if (!(error instanceof Error) || !handledErrors.has(error)) await showFailure(error, true)
      }
    } finally {
      availablePromptOpen = false
    }
  }

  function initialize() {
    if (initialized || !supported) return supported
    initialized = true
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.logger = updaterLogger(log)
    updater.on('checking-for-update', () => setState('checking', { progress: 0 }))
    updater.on('update-available', info => { void handleAvailable(info) })
    updater.on('update-not-available', info => {
      const shouldNotify = manualCheck
      manualCheck = false
      setState('idle', { progress: 0 })
      if (shouldNotify) {
        void showMessage({
          type: 'info',
          title: copy.noUpdateTitle,
          message: copy.noUpdateMessage(info?.version ?? currentVersion),
        })
      }
    })
    updater.on('download-progress', info => {
      const nextProgress = Math.max(0, Math.min(100, Math.round(info?.percent ?? 0)))
      if (state !== 'downloading' || nextProgress === progress) return
      setState('downloading', { progress: nextProgress })
    })
    updater.on('update-downloaded', info => {
      interactiveFlow = false
      setState('downloaded', { version: info?.version ?? targetVersion, progress: 100 })
      void promptInstall(info)
    })
    updater.on('error', error => {
      if (error instanceof Error) handledErrors.add(error)
      const shouldNotify = manualCheck || interactiveFlow || state === 'downloading' || state === 'installing'
      void showFailure(error, shouldNotify)
    })
    return true
  }

  async function check(manual = false) {
    if (!supported) {
      if (manual) await openReleasePage(RELEASES_URL)
      return
    }
    if (state === 'downloaded') {
      if (manual) await promptInstall({ version: targetVersion })
      return
    }
    if (!['idle'].includes(state)) return
    manualCheck = manual
    setState('checking', { progress: 0 })
    try {
      await updater.checkForUpdates()
    } catch (error) {
      if (!(error instanceof Error) || !handledErrors.has(error)) await showFailure(error, manual)
    }
  }

  return {
    check,
    initialize,
    menuItem,
    get state() { return state },
    get supported() { return supported },
  }
}

export { RELEASES_URL }
