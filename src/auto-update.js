import { createHash } from 'node:crypto'
import { access, chmod, mkdir, open, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import semver from 'semver'

const REPOSITORY = 'liguobao/dsh-desktop'
export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases/latest`
export const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`

function updateCopy(isChinese, platform) {
  const revealOnly = platform === 'linux'
  return isChinese ? {
      check: '检查更新…',
      checking: '正在检查更新…',
      downloading: progress => `正在下载安装包… ${String(progress)}%`,
      available: version => `可下载 v${version}`,
      downloaded: revealOnly ? '显示已下载的 AppImage…' : '打开已下载的安装包…',
      releases: '查看最新版本…',
      availableTitle: '发现新版本',
      availableMessage: version => `DSH Desktop ${version} 已发布`,
      availableDetail: current => `当前版本为 ${current}。是否将安装包下载到系统“下载”目录？`,
      download: '下载安装包',
      later: '稍后',
      readyTitle: '安装包已下载',
      readyMessage: version => `DSH Desktop ${version} 已保存到本地`,
      readyDetail: path => revealOnly
        ? `文件位于 ${path}。应用将自动退出，请用它替换当前 AppImage 后重新打开。`
        : `文件位于 ${path}。打开安装包后应用将自动退出，请按系统提示完成更新。`,
      open: revealOnly ? '在文件夹中显示' : '打开安装包',
      noUpdateTitle: '已是最新版本',
      noUpdateMessage: version => `DSH Desktop ${version} 已是最新版本。`,
      failedTitle: '更新下载失败',
      failedMessage: '无法下载 DSH Desktop 安装包。',
    } : {
      check: 'Check for Updates…',
      checking: 'Checking for Updates…',
      downloading: progress => `Downloading Installer… ${String(progress)}%`,
      available: version => `Download v${version}`,
      downloaded: revealOnly ? 'Show Downloaded AppImage…' : 'Open Downloaded Installer…',
      releases: 'View Latest Release…',
      availableTitle: 'Update Available',
      availableMessage: version => `DSH Desktop ${version} is available`,
      availableDetail: current => `You are using ${current}. Download the installer to your system Downloads folder?`,
      download: 'Download Installer',
      later: 'Later',
      readyTitle: 'Installer Downloaded',
      readyMessage: version => `DSH Desktop ${version} has been saved locally`,
      readyDetail: path => revealOnly
        ? `The file is at ${path}. The app will quit automatically; replace the current AppImage with this file and launch it again.`
        : `The file is at ${path}. The app will quit after you open the installer; follow the system prompts to finish updating.`,
      open: revealOnly ? 'Show in Folder' : 'Open Installer',
      noUpdateTitle: 'You’re Up to Date',
      noUpdateMessage: version => `DSH Desktop ${version} is the latest version.`,
      failedTitle: 'Update Download Failed',
      failedMessage: 'The DSH Desktop installer could not be downloaded.',
    }
}

export function installerAssetName({ version, platform, arch }) {
  if (semver.valid(version) !== version) throw new Error('Invalid release version')
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) {
    return `DSH-Desktop-v${version}-macos-${arch}.dmg`
  }
  if (platform === 'win32' && arch === 'x64') {
    return `DSH-Desktop-v${version}-windows-${arch}-setup.exe`
  }
  if (platform === 'linux' && arch === 'x64') {
    return `DSH-Desktop-v${version}-linux-${arch}.AppImage`
  }
  throw new Error(`No installer is published for ${platform}/${arch}`)
}

export function supportsInstallerDownloads({ isPackaged, platform, arch }) {
  if (!isPackaged) return false
  try {
    installerAssetName({ version: '0.0.0', platform, arch })
    return true
  } catch {
    return false
  }
}

function validatedAssetUrl(url, tagName, assetName) {
  const parsed = new URL(url)
  const prefix = `/${REPOSITORY}/releases/download/${tagName}/`
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || !parsed.pathname.startsWith(prefix)) {
    throw new Error('Release asset URL is not trusted')
  }
  if (decodeURIComponent(parsed.pathname.slice(prefix.length)) !== assetName) {
    throw new Error('Release asset URL does not match its file name')
  }
  return parsed.href
}

export function parseLatestRelease(release, { platform, arch }) {
  if (release === null || typeof release !== 'object' || typeof release.tag_name !== 'string') {
    throw new Error('GitHub returned an invalid Release')
  }
  if (release.draft === true || release.prerelease === true || !release.tag_name.startsWith('v')) {
    throw new Error('GitHub returned an unsupported Release')
  }
  const version = release.tag_name.slice(1)
  const name = installerAssetName({ version, platform, arch })
  const asset = Array.isArray(release.assets)
    ? release.assets.find(candidate => candidate?.name === name)
    : undefined
  if (asset === undefined || asset.state !== 'uploaded') throw new Error(`Release asset is missing: ${name}`)
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('Release asset size is invalid')
  if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) {
    throw new Error('Release asset has no valid SHA-256 digest')
  }
  return {
    version,
    asset: {
      digest: asset.digest.toLowerCase(),
      name,
      size: asset.size,
      url: validatedAssetUrl(asset.browser_download_url, release.tag_name, name),
    },
  }
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function availableDownloadPath(directory, fileName) {
  if (basename(fileName) !== fileName) throw new Error('Invalid installer file name')
  const extension = extname(fileName)
  const stem = fileName.slice(0, fileName.length - extension.length)
  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? '' : ` (${String(index)})`
    const candidate = join(directory, `${stem}${suffix}${extension}`)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error('Could not choose a local installer file name')
}

async function writeChunk(handle, chunk) {
  const buffer = Buffer.from(chunk)
  let offset = 0
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset)
    if (result.bytesWritten <= 0) throw new Error('Could not write the installer file')
    offset += result.bytesWritten
  }
  return buffer
}

export async function downloadInstallerAsset({
  asset,
  downloadsDirectory,
  fetchImpl,
  platform,
  signal,
  onProgress = () => {},
}) {
  await mkdir(downloadsDirectory, { recursive: true })
  const destination = await availableDownloadPath(downloadsDirectory, asset.name)
  const response = await fetchImpl(asset.url, {
    headers: { Accept: 'application/octet-stream' },
    redirect: 'follow',
    signal,
  })
  if (!response.ok) throw new Error(`GitHub download failed with HTTP ${String(response.status)}`)
  if (response.body === null) throw new Error('GitHub download returned an empty response')

  const handle = await open(destination, 'wx', 0o600)
  const hash = createHash('sha256')
  let received = 0
  let completed = false
  let lastProgress = -1
  try {
    for await (const chunk of response.body) {
      const buffer = await writeChunk(handle, chunk)
      hash.update(buffer)
      received += buffer.length
      if (received > asset.size) throw new Error('Downloaded installer is larger than the Release asset')
      const progress = Math.min(100, Math.floor((received / asset.size) * 100))
      if (progress !== lastProgress) {
        lastProgress = progress
        onProgress(progress)
      }
    }
    await handle.sync()
    if (received !== asset.size) throw new Error(`Installer size mismatch: expected ${String(asset.size)}, received ${String(received)}`)
    const actualDigest = `sha256:${hash.digest('hex')}`
    if (actualDigest !== asset.digest) throw new Error('Installer SHA-256 verification failed')
    if (platform === 'linux') await chmod(destination, 0o755)
    completed = true
    if (lastProgress !== 100) onProgress(100)
    return destination
  } finally {
    await handle.close()
    if (!completed) await rm(destination, { force: true })
  }
}

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error)
}

export function createInstallerUpdateController({
  isPackaged,
  platform,
  arch,
  isChinese,
  currentVersion,
  downloadsDirectory,
  fetchImpl,
  dialog,
  getWindow,
  openReleasePage,
  openDownloadedFile,
  quitApp = () => {},
  onStateChange = () => {},
  log = () => {},
  downloadImpl = downloadInstallerAsset,
}) {
  const copy = updateCopy(isChinese, platform)
  const supported = supportsInstallerDownloads({ isPackaged, platform, arch })
  let state = supported ? 'idle' : 'unsupported'
  let progress = 0
  let targetVersion
  let downloadedPath
  let operationController

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
    if (state === 'downloaded') return { label: copy.downloaded, enabled: true }
    return { label: copy.check, enabled: true }
  }

  function showMessage(options) {
    const window = getWindow()
    return window?.isDestroyed?.() === false
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)
  }

  async function showFailure(error, notify) {
    const detail = errorDetail(error)
    log('error', `Update download failed: ${detail}`)
    setState(downloadedPath === undefined ? 'idle' : 'downloaded', { progress: 0 })
    if (notify) {
      await showMessage({
        type: 'error',
        title: copy.failedTitle,
        message: copy.failedMessage,
        detail,
      })
    }
  }

  async function promptDownloaded() {
    if (downloadedPath === undefined) return
    const result = await showMessage({
      type: 'info',
      title: copy.readyTitle,
      message: copy.readyMessage(targetVersion ?? currentVersion),
      detail: copy.readyDetail(downloadedPath),
      buttons: [copy.open, copy.later],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (result.response !== 0) return
    try {
      const error = await openDownloadedFile(downloadedPath)
      if (typeof error === 'string' && error !== '') throw new Error(error)
      quitApp()
    } catch (error) {
      await showFailure(error, true)
    }
  }

  async function fetchLatestRelease(signal) {
    const response = await fetchImpl(LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
    })
    if (!response.ok) throw new Error(`GitHub Release check failed with HTTP ${String(response.status)}`)
    return parseLatestRelease(await response.json(), { platform, arch })
  }

  async function check(manual = false) {
    if (!supported) {
      if (manual) await openReleasePage(RELEASES_URL)
      return
    }
    if (state === 'downloaded') {
      if (manual) await promptDownloaded()
      return
    }
    if (state !== 'idle') return
    setState('checking', { progress: 0 })
    operationController = new AbortController()
    let interactive = false
    try {
      const release = await fetchLatestRelease(operationController.signal)
      if (!semver.gt(release.version, currentVersion)) {
        setState('idle', { progress: 0 })
        if (manual) {
          await showMessage({
            type: 'info',
            title: copy.noUpdateTitle,
            message: copy.noUpdateMessage(currentVersion),
          })
        }
        return
      }
      targetVersion = release.version
      setState('available', { version: release.version })
      const result = await showMessage({
        type: 'info',
        title: copy.availableTitle,
        message: copy.availableMessage(release.version),
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
      interactive = true
      setState('downloading', { progress: 0 })
      downloadedPath = await downloadImpl({
        asset: release.asset,
        downloadsDirectory,
        fetchImpl,
        platform,
        signal: operationController.signal,
        onProgress: next => setState('downloading', { progress: next }),
      })
      setState('downloaded', { progress: 100 })
      await promptDownloaded()
    } catch (error) {
      if (!operationController.signal.aborted) await showFailure(error, manual || interactive)
    } finally {
      operationController = undefined
    }
  }

  function abort() {
    operationController?.abort()
  }

  return {
    abort,
    check,
    initialize: () => supported,
    menuItem,
    get downloadedPath() { return downloadedPath },
    get state() { return state },
    get supported() { return supported },
  }
}
