const REPOSITORY = 'liguobao/dsh-desktop'
export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases/latest`

function updateCopy(isChinese) {
  return isChinese ? {
    check: '检查更新…',
    checking: '正在检查更新…',
    downloading: progress => `正在下载更新… ${String(progress)}%`,
    available: version => `下载 v${version}`,
    downloaded: '重启以更新',
    releases: '查看最新版本…',
    noUpdateTitle: '已是最新版本',
    noUpdateMessage: version => `DSH Desktop ${version} 已是最新版本。`,
    failedTitle: '更新失败',
    failedMessage: '无法检查或下载 DSH Desktop 更新。',
  } : {
    check: 'Check for Updates…',
    checking: 'Checking for Updates…',
    downloading: progress => `Downloading Update… ${String(progress)}%`,
    available: version => `Download v${version}`,
    downloaded: 'Restart to Update',
    releases: 'View Latest Release…',
    noUpdateTitle: 'You’re Up to Date',
    noUpdateMessage: version => `DSH Desktop ${version} is the latest version.`,
    failedTitle: 'Update Failed',
    failedMessage: 'The DSH Desktop update could not be checked or downloaded.',
  }
}

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Drives the bundled electron-updater through a small state machine and shares
 * it with both the Help menu and the session-header button. `updater` is the
 * `autoUpdater` singleton from `electron-updater`, injected by the caller so
 * this module stays importable from plain Node tests.
 */
export function createAutoUpdateController({
  isPackaged,
  isChinese,
  currentVersion,
  updater,
  openReleasePage,
  dialog,
  getWindow,
  onStateChange = () => {},
  log = () => {},
}) {
  const copy = updateCopy(isChinese)
  const supported = isPackaged
  let state = supported ? 'idle' : 'unsupported'
  let progress = 0
  let targetVersion

  function setState(next, details = {}) {
    state = next
    if (details.progress !== undefined) progress = details.progress
    if (details.version !== undefined) targetVersion = details.version
    onStateChange()
  }

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true

  updater.on('checking-for-update', () => setState('checking', { progress: 0 }))
  updater.on('update-available', info => setState('available', { version: info.version }))
  updater.on('update-not-available', () => setState('idle', { progress: 0 }))
  updater.on('download-progress', info => setState('downloading', { progress: Math.round(info.percent) }))
  updater.on('update-downloaded', info => setState('downloaded', { version: info.version, progress: 100 }))
  updater.on('update-cancelled', () => setState('idle', { progress: 0 }))
  updater.on('error', error => {
    log('error', `Update failed: ${errorDetail(error)}`)
    if (state !== 'downloaded') setState('idle', { progress: 0 })
  })

  function menuItem() {
    if (!supported) return { label: copy.releases, enabled: true }
    if (state === 'checking') return { label: copy.checking, enabled: false }
    if (state === 'downloading') return { label: copy.downloading(progress), enabled: false }
    if (state === 'available') return { label: copy.available(targetVersion), enabled: true }
    if (state === 'downloaded') return { label: copy.downloaded, enabled: true }
    return { label: copy.check, enabled: true }
  }

  function showMessage(options) {
    const window = getWindow()
    return window?.isDestroyed?.() === false
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)
  }

  async function check(manual = false) {
    if (!supported) {
      if (manual) await openReleasePage(RELEASES_URL)
      return
    }
    if (state === 'checking' || state === 'downloading') return
    if (state === 'downloaded') {
      if (manual) restart()
      return
    }
    try {
      const result = await updater.checkForUpdates()
      if (manual && (result === null || !result.isUpdateAvailable)) {
        await showMessage({
          type: 'info',
          title: copy.noUpdateTitle,
          message: copy.noUpdateMessage(currentVersion),
        })
      }
    } catch (error) {
      if (manual) {
        await showMessage({
          type: 'error',
          title: copy.failedTitle,
          message: copy.failedMessage,
          detail: errorDetail(error),
        })
      }
    }
  }

  async function download() {
    if (state !== 'available') return
    try {
      await updater.downloadUpdate()
    } catch (error) {
      log('error', `Update download failed: ${errorDetail(error)}`)
    }
  }

  function restart() {
    if (state !== 'downloaded') return
    updater.quitAndInstall()
  }

  return {
    check,
    download,
    initialize: () => supported,
    menuItem,
    restart,
    get progress() { return progress },
    get state() { return state },
    get supported() { return supported },
    get version() { return targetVersion },
  }
}
