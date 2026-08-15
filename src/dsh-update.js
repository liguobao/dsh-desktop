import {
  checkForDshUpdate,
  deactivateManagedDsh,
  installDshVersion,
} from './dsh-runtime.js'

function dshUpdateCopy(isChinese) {
  return isChinese ? {
      check: '检查 DSH 更新…',
      checking: '正在检查 DSH 更新…',
      installing: version => `正在更新 DSH 至 ${version}…`,
      restarting: '正在使用新版 DSH 重启…',
      restore: version => `恢复内置 DSH ${version}…`,
      availableTitle: '发现 DSH 更新',
      availableMessage: version => `@deepseek-ai/dsh ${version} 已发布`,
      availableDetail: current => `当前运行版本为 ${current}。更新将安装到用户数据目录，并重启本地 Harness。`,
      update: '更新并重启',
      later: '稍后',
      currentTitle: 'DSH 已是最新版本',
      currentMessage: version => `@deepseek-ai/dsh ${version} 已是 npm latest 版本。`,
      failedTitle: 'DSH 更新失败',
      failedMessage: '无法完成 @deepseek-ai/dsh 在线更新。',
      restoreTitle: '恢复内置 DSH',
      restoreMessage: version => `是否恢复使用 DSH Desktop 内置的 ${version} 版本？`,
      restoreDetail: '当前会话会重新加载，已下载的 DSH 版本会保留在用户数据目录。',
      restoreNow: '恢复并重启',
      cancel: '取消',
      operationBusy: '另一个扩展或 DSH 操作正在进行。',
    } : {
      check: 'Check for DSH Updates…',
      checking: 'Checking for DSH Updates…',
      installing: version => `Updating DSH to ${version}…`,
      restarting: 'Restarting with the New DSH Version…',
      restore: version => `Restore Bundled DSH ${version}…`,
      availableTitle: 'DSH Update Available',
      availableMessage: version => `@deepseek-ai/dsh ${version} is available`,
      availableDetail: current => `The running version is ${current}. The update will be installed in your user data directory, then the local Harness will restart.`,
      update: 'Update and Restart',
      later: 'Later',
      currentTitle: 'DSH Is Up to Date',
      currentMessage: version => `@deepseek-ai/dsh ${version} is the latest npm version.`,
      failedTitle: 'DSH Update Failed',
      failedMessage: 'The @deepseek-ai/dsh online update could not be completed.',
      restoreTitle: 'Restore Bundled DSH',
      restoreMessage: version => `Restore the DSH ${version} version bundled with DSH Desktop?`,
      restoreDetail: 'The current session will reload. Downloaded DSH versions remain in the user data directory.',
      restoreNow: 'Restore and Restart',
      cancel: 'Cancel',
      operationBusy: 'Another extension or DSH operation is already running.',
    }
}

export function createDshUpdateController({
  initialRuntime,
  runtimeRoot,
  pnpmEntry,
  execPath,
  env,
  isChinese,
  dialog,
  getWindow,
  onRuntimeChanged,
  onStateChange = () => {},
  onOutput = () => {},
  log = () => {},
  checkImpl = checkForDshUpdate,
  installImpl = installDshVersion,
  deactivateImpl = deactivateManagedDsh,
  isOperationBlocked = () => false,
}) {
  const copy = dshUpdateCopy(isChinese)
  const bundledRuntime = initialRuntime.bundled ?? initialRuntime
  let runtime = initialRuntime
  let state = 'idle'
  let targetVersion
  let operationController

  function setState(next, version) {
    state = next
    if (version !== undefined) targetVersion = version
    onStateChange()
  }

  function showMessage(options) {
    const window = getWindow()
    return window?.isDestroyed?.() === false
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)
  }

  function menuItem() {
    if (state === 'checking') return { label: copy.checking, enabled: false }
    if (state === 'available') return { label: copy.availableMessage(targetVersion), enabled: false }
    if (state === 'installing') return { label: copy.installing(targetVersion), enabled: false }
    if (state === 'restarting') return { label: copy.restarting, enabled: false }
    return { label: copy.check, enabled: true }
  }

  function restoreItem() {
    if (runtime.source !== 'managed') return undefined
    return {
      label: copy.restore(runtime.bundled.version),
      enabled: state === 'idle',
    }
  }

  async function fail(error, notify) {
    const detail = error instanceof Error ? error.message : String(error)
    log('error', `DSH update failed: ${detail}`)
    setState('idle')
    if (notify) {
      await showMessage({
        type: 'error',
        title: copy.failedTitle,
        message: copy.failedMessage,
        detail,
      })
    }
  }

  async function install(version) {
    setState('installing', version)
    operationController = new AbortController()
    try {
      const installation = await installImpl({
        version,
        runtimeRoot,
        pnpmEntry,
        execPath,
        env,
        signal: operationController.signal,
        onOutput,
      })
      runtime = { ...installation, bundled: bundledRuntime }
      setState('restarting')
      await onRuntimeChanged(runtime)
      setState('idle')
    } catch (error) {
      if (!operationController.signal.aborted) await fail(error, true)
    } finally {
      operationController = undefined
    }
  }

  async function check(manual = false) {
    if (state !== 'idle') return
    if (isOperationBlocked()) {
      if (manual) await fail(new Error(copy.operationBusy), true)
      return
    }
    setState('checking')
    operationController = new AbortController()
    try {
      const result = await checkImpl({
        currentVersion: runtime.version,
        runtimeRoot,
        pnpmEntry,
        execPath,
        env,
        signal: operationController.signal,
        onOutput,
      })
      if (!result.available) {
        setState('idle')
        if (manual) {
          await showMessage({
            type: 'info',
            title: copy.currentTitle,
            message: copy.currentMessage(runtime.version),
          })
        }
        return
      }
      setState('available', result.latestVersion)
      const response = await showMessage({
        type: 'info',
        title: copy.availableTitle,
        message: copy.availableMessage(result.latestVersion),
        detail: copy.availableDetail(runtime.version),
        buttons: [copy.update, copy.later],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (response.response === 0) await install(result.latestVersion)
      else setState('idle')
    } catch (error) {
      if (!operationController.signal.aborted) await fail(error, manual)
    } finally {
      operationController = undefined
    }
  }

  async function restoreBundled() {
    if (state !== 'idle' || runtime.source !== 'managed') return
    if (isOperationBlocked()) {
      await fail(new Error(copy.operationBusy), true)
      return
    }
    const response = await showMessage({
      type: 'warning',
      title: copy.restoreTitle,
      message: copy.restoreMessage(runtime.bundled.version),
      detail: copy.restoreDetail,
      buttons: [copy.restoreNow, copy.cancel],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response.response !== 0) return
    try {
      deactivateImpl(runtimeRoot)
      runtime = bundledRuntime
      setState('restarting')
      await onRuntimeChanged(runtime)
      setState('idle')
    } catch (error) {
      await fail(error, true)
    }
  }

  function useBundledFallback() {
    if (runtime.source !== 'managed') return false
    deactivateImpl(runtimeRoot)
    runtime = bundledRuntime
    setState('idle')
    return true
  }

  function abort() {
    operationController?.abort()
  }

  return {
    abort,
    check,
    menuItem,
    restoreBundled,
    restoreItem,
    useBundledFallback,
    get runtime() { return runtime },
    get state() { return state },
  }
}
