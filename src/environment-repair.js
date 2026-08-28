import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  installDesktopPlugin,
  prepareHarnessToolchain,
} from './desktop-integration.js'
import {
  ensureProfileInitialized,
  installBundledFileViewerPlugin,
  installBundledRemotePlugin,
} from './plugin-management.js'

const DSH_HOME_DIRECTORIES = ['profiles', 'sessions', 'storages', 'skills', 'scripts', 'cache']

async function runRepairAction(actions, kind, action) {
  try {
    const result = await action()
    actions.push({
      kind,
      status: result?.status ?? 'applied',
      detail: result?.detail ?? kind,
    })
    return result
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    actions.push({ kind, status: 'failed', detail })
    return undefined
  }
}

/**
 * Rebuild the app-owned pieces that DSH Desktop needs to start Harness.
 * The repair is intentionally conservative and offline-first: it creates
 * missing profile/home files, rewrites Desktop-owned launchers, and reseeds
 * bundled plugins from the installed application.
 */
export async function repairDesktopEnvironment({
  dshHome,
  toolchainDirectory,
  execPath,
  pnpmEntry,
  desktopPluginDir,
  remotePluginDir,
  fileViewerPluginDir,
  env = process.env,
  profile = 'web',
  onOutput = () => {},
  prepareHarnessToolchainImpl = prepareHarnessToolchain,
  installDesktopPluginImpl = installDesktopPlugin,
  ensureProfileInitializedImpl = ensureProfileInitialized,
  installBundledRemotePluginImpl = installBundledRemotePlugin,
  installBundledFileViewerPluginImpl = installBundledFileViewerPlugin,
} = {}) {
  if (typeof dshHome !== 'string' || dshHome.trim() === '') throw new Error('DSH home is required')
  if (typeof toolchainDirectory !== 'string' || toolchainDirectory.trim() === '') {
    throw new Error('Toolchain directory is required')
  }
  if (typeof execPath !== 'string' || execPath.trim() === '') throw new Error('Executable path is required')
  if (typeof pnpmEntry !== 'string' || pnpmEntry.trim() === '') throw new Error('pnpm entry is required')
  if (typeof desktopPluginDir !== 'string' || desktopPluginDir.trim() === '') {
    throw new Error('Desktop plugin directory is required')
  }
  if (typeof remotePluginDir !== 'string' || remotePluginDir.trim() === '') {
    throw new Error('Remote plugin directory is required')
  }
  if (typeof fileViewerPluginDir !== 'string' || fileViewerPluginDir.trim() === '') {
    throw new Error('File viewer plugin directory is required')
  }

  const startedAt = performance.now()
  const actions = []
  let repairedEnv = env

  await runRepairAction(actions, 'home', () => {
    const wasPresent = existsSync(dshHome)
    mkdirSync(dshHome, { recursive: true })
    const missing = []
    for (const name of DSH_HOME_DIRECTORIES) {
      const directory = join(dshHome, name)
      if (!existsSync(directory)) missing.push(name)
      mkdirSync(directory, { recursive: true })
    }
    return {
      status: wasPresent && missing.length === 0 ? 'info' : 'applied',
      detail: missing.length === 0
        ? `DSH home is ready: ${dshHome}`
        : `Created missing DSH home directories: ${missing.join(', ')}`,
    }
  })

  await runRepairAction(actions, 'profile', () => {
    const profileDir = join(dshHome, 'profiles', profile)
    const manifestExisted = existsSync(join(profileDir, 'package.json'))
    const workspaceExisted = existsSync(join(profileDir, 'pnpm-workspace.yaml'))
    const initialized = ensureProfileInitializedImpl(dshHome, profile)
    return {
      status: manifestExisted && workspaceExisted ? 'info' : 'applied',
      detail: `Profile ${profile} is ready: ${initialized}`,
    }
  })

  await runRepairAction(actions, 'toolchain', () => {
    repairedEnv = prepareHarnessToolchainImpl({
      directory: toolchainDirectory,
      execPath,
      pnpmEntry,
      env,
    })
    return {
      status: 'applied',
      detail: `Rebuilt Desktop-owned Node and pnpm launchers: ${toolchainDirectory}`,
    }
  })

  await runRepairAction(actions, 'desktop-plugin', () => {
    const target = installDesktopPluginImpl({ sourceDir: desktopPluginDir, dshHome })
    return {
      status: 'applied',
      detail: `Reinstalled Desktop integration plugin: ${target}`,
    }
  })

  await runRepairAction(actions, 'remote-plugin', async () => {
    const target = await installBundledRemotePluginImpl({
      sourceDir: remotePluginDir,
      dshHome,
      profile,
    })
    return {
      status: target === undefined ? 'skipped' : 'applied',
      detail: target === undefined
        ? 'Bundled remote plugin is already newer and was left untouched'
        : `Bundled remote plugin is ready: ${target}`,
    }
  })

  await runRepairAction(actions, 'file-viewer-plugin', async () => {
    const target = await installBundledFileViewerPluginImpl({
      sourceDir: fileViewerPluginDir,
      dshHome,
      profile,
    })
    return {
      status: target === undefined ? 'skipped' : 'applied',
      detail: target === undefined
        ? 'Bundled file viewer plugin is already newer and was left untouched'
        : `Bundled file viewer plugin is ready: ${target}`,
    }
  })

  const failedCount = actions.filter(action => action.status === 'failed').length
  const appliedCount = actions.filter(action => action.status === 'applied').length
  const summary = failedCount === 0
    ? `Runtime environment repair completed (${String(appliedCount)} step${appliedCount === 1 ? '' : 's'} applied).`
    : `Runtime environment repair finished with ${String(failedCount)} failed step${failedCount === 1 ? '' : 's'}.`
  onOutput('desktop', `${summary}\n`)

  return {
    ok: failedCount === 0,
    profile,
    dshHome,
    actions,
    appliedCount,
    failedCount,
    durationMs: Math.round(performance.now() - startedAt),
    summary,
    env: repairedEnv,
    profileDir: dirname(join(dshHome, 'profiles', profile, 'package.json')),
  }
}
