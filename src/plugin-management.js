import { spawn as nodeSpawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'

export const PLUGIN_PROFILE = 'web'
export const MAX_PLUGIN_SPEC_LENGTH = 300
export const MAX_PLUGIN_OUTPUT_LENGTH = 64 * 1024
export const SYSTEM_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const PACKAGE_SELECTOR_PATTERN = /^[a-z0-9~^*<>=|+_.-]+$/i
const GITHUB_SHORTHAND_PATTERN = /^github:([a-z0-9](?:[a-z0-9-]{0,38}))\/([a-z0-9._-]+?)(?:\.git)?#([a-z0-9][a-z0-9._\/-]{0,127})$/i
const GITHUB_URL_PATTERN = /^(?:git\+)?https:\/\/github\.com\/([a-z0-9](?:[a-z0-9-]{0,38}))\/([a-z0-9._-]+?)(?:\.git)?#([a-z0-9][a-z0-9._\/-]{0,127})$/i
const GITHUB_BUILD_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepublish', 'prepack', 'prepare', 'publish'])

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`
  writeFileSync(temporary, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function writeTextAtomic(path, value) {
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`
  writeFileSync(temporary, value, { mode: 0o600 })
  renameSync(temporary, path)
}

function packageManifestPath(profileDir, packageName) {
  return join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json')
}

function readInstalledManifest(profileDir, packageName) {
  try {
    return readJson(packageManifestPath(profileDir, packageName))
  } catch {
    return undefined
  }
}

function installedPluginRequiresBuild(profileDir, packageName) {
  const manifest = readInstalledManifest(profileDir, packageName)
  const scripts = manifest?.scripts
  const declaresBuildScript = scripts !== undefined && scripts !== null && typeof scripts === 'object'
    && Object.entries(scripts).some(([name, command]) =>
      GITHUB_BUILD_SCRIPTS.has(name) && typeof command === 'string' && command.trim() !== '',
    )
  return declaresBuildScript || existsSync(join(profileDir, 'node_modules', ...packageName.split('/'), 'binding.gyp'))
}

function pluginMetadata(profileDir, packageName, requested, enabled) {
  const manifest = readInstalledManifest(profileDir, packageName)
  const bundle = manifest?.dsh?.bundle?.patch !== undefined
  return {
    name: packageName,
    requested,
    source: /^(?:github:|git\+https:\/\/github\.com\/|https:\/\/github\.com\/)/i.test(requested) ? 'github' : 'npm',
    version: typeof manifest?.version === 'string' ? manifest.version : undefined,
    description: typeof manifest?.description === 'string' ? manifest.description : undefined,
    homepage: typeof manifest?.homepage === 'string' ? manifest.homepage : undefined,
    installed: manifest !== undefined,
    bundle,
    enabled: bundle && enabled,
  }
}

export function profileDirectory(dshHome, profile = PLUGIN_PROFILE) {
  return join(dshHome, 'profiles', profile)
}

export function normalizePluginSpec(value) {
  if (typeof value !== 'string') throw new Error('Plugin package is required')
  const spec = value.trim()
  if (spec.length === 0) throw new Error('Plugin package is required')
  if (spec.length > MAX_PLUGIN_SPEC_LENGTH) throw new Error('Plugin package is too long')
  if (/\s|[\0\r\n]/.test(spec) || spec.startsWith('-')) throw new Error('Invalid plugin package')

  const github = GITHUB_SHORTHAND_PATTERN.exec(spec) ?? GITHUB_URL_PATTERN.exec(spec)
  if (github !== null) {
    const [, owner, repository, ref] = github
    if (ref.includes('..') || ref.includes('//') || ref.endsWith('/')) {
      throw new Error('Invalid GitHub revision')
    }
    return {
      spec: `github:${owner}/${repository}#${ref}`,
      source: 'github',
      repository: `${owner}/${repository}`,
      ref,
    }
  }
  if (/^(?:github:|(?:git\+)?https:\/\/github\.com\/)/i.test(spec)) {
    throw new Error('GitHub plugins must use owner/repo#tag-or-commit')
  }

  const slash = spec.startsWith('@') ? spec.indexOf('/') : -1
  const selectorAt = spec.indexOf('@', slash + 1)
  const packageName = selectorAt === -1 ? spec : spec.slice(0, selectorAt)
  const selector = selectorAt === -1 ? undefined : spec.slice(selectorAt + 1)
  if (!PACKAGE_NAME_PATTERN.test(packageName) || (selector !== undefined && !PACKAGE_SELECTOR_PATTERN.test(selector))) {
    throw new Error('Use an npm package name with an optional version')
  }
  if (SYSTEM_BUNDLES.has(packageName)) throw new Error('System bundles are managed by DSH Desktop')
  return { spec, packageName, source: 'npm' }
}

export function readPluginCatalog({ dshHome, profile = PLUGIN_PROFILE }) {
  const profileDir = profileDirectory(dshHome, profile)
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) {
    return { profile, profileDir, plugins: [], system: [], initialized: false }
  }

  const manifest = readJson(manifestPath)
  const dependencies = manifest.dependencies ?? {}
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const dependencyNames = new Set(Object.keys(dependencies).filter(name => !SYSTEM_BUNDLES.has(name)))
  const plugins = Object.entries(dependencies).filter(([name]) => !SYSTEM_BUNDLES.has(name)).map(([name, requested]) =>
    pluginMetadata(profileDir, name, typeof requested === 'string' ? requested : '', bundles.includes(name)),
  )
  const system = bundles.filter(name => SYSTEM_BUNDLES.has(name) || !dependencyNames.has(name)).map(name => ({ name, enabled: true }))
  return { profile, profileDir, plugins, system, initialized: true }
}

export function setPluginEnabled({ dshHome, name, enabled, profile = PLUGIN_PROFILE }) {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('Invalid plugin package name')
  if (SYSTEM_BUNDLES.has(name)) throw new Error('System bundles cannot be changed')
  const profileDir = profileDirectory(dshHome, profile)
  const manifestPath = join(profileDir, 'package.json')
  const manifest = readJson(manifestPath)
  if (!Object.hasOwn(manifest.dependencies ?? {}, name)) throw new Error('Plugin is not installed')
  const plugin = pluginMetadata(profileDir, name, manifest.dependencies[name], false)
  if (!plugin.installed) throw new Error('Plugin files are missing')
  if (!plugin.bundle) throw new Error('Package does not declare a DSH bundle')

  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? [...manifest.dsh.profile.bundles] : []
  const nextBundles = enabled
    ? bundles.includes(name) ? bundles : [...bundles, name]
    : bundles.filter(candidate => candidate !== name)
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...manifest.dsh?.profile, bundles: nextBundles },
  }
  writeJsonAtomic(manifestPath, manifest)
}

export function forgetPluginBundle({ dshHome, name, profile = PLUGIN_PROFILE }) {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('Invalid plugin package name')
  if (SYSTEM_BUNDLES.has(name)) throw new Error('System bundles cannot be removed')
  const manifestPath = join(profileDirectory(dshHome, profile), 'package.json')
  const manifest = readJson(manifestPath)
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...manifest.dsh?.profile, bundles: bundles.filter(candidate => candidate !== name) },
  }
  writeJsonAtomic(manifestPath, manifest)
}

function appendOutput(current, chunk) {
  if (current.length >= MAX_PLUGIN_OUTPUT_LENGTH) return current
  return `${current}${String(chunk)}`.slice(0, MAX_PLUGIN_OUTPUT_LENGTH)
}

export function runPnpm({
  args,
  env = process.env,
  execPath = process.execPath,
  pnpmEntry,
  profileDir,
  signal,
  spawnImpl = nodeSpawn,
  onOutput = () => {},
}) {
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
    return Promise.reject(new Error('Invalid pnpm arguments'))
  }
  return new Promise((resolve, reject) => {
    const child = spawnImpl(execPath, [pnpmEntry, ...args], {
      cwd: profileDir,
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      windowsHide: true,
      shell: false,
      signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const capture = (source, chunk) => {
      output = appendOutput(output, chunk)
      onOutput(source, String(chunk))
    }
    child.stdout?.on('data', chunk => capture('stdout', chunk))
    child.stderr?.on('data', chunk => capture('stderr', chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve({ output })
      else {
        const detail = output.trim() || `pnpm exited with code ${String(code)} and signal ${String(signal)}`
        reject(new Error(detail))
      }
    })
  })
}

function findInstalledPlugin(catalog, previous, normalized) {
  if (normalized.source === 'npm') {
    return catalog.plugins.find(candidate => candidate.name === normalized.packageName)
  }
  const repository = normalized.repository.toLowerCase()
  const repositoryMatches = catalog.plugins.filter(candidate => candidate.requested.toLowerCase().includes(repository))
  if (repositoryMatches.length === 1) return repositoryMatches[0]
  const changed = catalog.plugins.filter(candidate => previous.get(candidate.name) !== candidate.requested)
  return changed.length === 1 ? changed[0] : undefined
}

function githubBuildKey(packageName, normalized) {
  return `${packageName}@git+https://github.com/${normalized.repository}.git`
}

function resolvedGitHubCommit(profileDir, packageName) {
  const lockPath = join(profileDir, 'pnpm-lock.yaml')
  if (!existsSync(lockPath)) return undefined
  const lockfile = parse(readFileSync(lockPath, 'utf8'))
  const dependency = lockfile?.importers?.['.']?.dependencies?.[packageName]
  const resolution = typeof dependency === 'string' ? dependency : dependency?.version
  if (typeof resolution !== 'string') return undefined
  return /(?:\/tar\.gz\/|#)([a-f0-9]{40})(?:$|[?&])/i.exec(resolution)?.[1]
}

function forgetGitHubBuildPermission(profileDir, plugin) {
  if (plugin.source !== 'github') return
  let normalized
  try {
    normalized = normalizePluginSpec(plugin.requested)
  } catch {
    return
  }
  if (normalized.source !== 'github') return
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) return
  const workspace = parse(readFileSync(workspacePath, 'utf8'))
  if (typeof workspace !== 'object' || workspace === null || Array.isArray(workspace)) return
  if (typeof workspace.allowBuilds !== 'object' || workspace.allowBuilds === null || Array.isArray(workspace.allowBuilds)) return
  const key = githubBuildKey(plugin.name, normalized)
  if (workspace.allowBuilds[key] !== true) return
  delete workspace.allowBuilds[key]
  writeTextAtomic(workspacePath, stringify(workspace))
}

export async function installPlugin({
  dshHome,
  pnpmEntry,
  spec,
  allowBuildScripts = false,
  execPath,
  env,
  onOutput,
  signal,
  profile = PLUGIN_PROFILE,
  runPnpmImpl = runPnpm,
}) {
  if (typeof allowBuildScripts !== 'boolean') throw new Error('Invalid build-script permission')
  const normalized = normalizePluginSpec(spec)
  const profileDir = profileDirectory(dshHome, profile)
  const before = readPluginCatalog({ dshHome, profile })
  const previous = new Map(before.plugins.map(plugin => [plugin.name, plugin.requested]))
  const firstInstall = await runPnpmImpl({
    args: [
      'add',
      '--save-prod',
      '--reporter',
      'append-only',
      ...(normalized.source === 'github' ? ['--ignore-scripts'] : []),
      normalized.spec,
    ],
    env,
    execPath,
    onOutput,
    pnpmEntry,
    profileDir,
    signal,
  })
  const buildScriptsIgnored = normalized.source === 'github' && /(?:GIT_DEP_PREPARE_NOT_ALLOWED|IGNORED_BUILDS|build scripts were ignored)/i.test(firstInstall.output)
  let catalog = readPluginCatalog({ dshHome, profile })
  let plugin = findInstalledPlugin(catalog, previous, normalized)
  if (normalized.source === 'github' && plugin === undefined) {
    throw new Error('Installed the GitHub repository but could not identify its package name')
  }
  if (normalized.source === 'github' && plugin !== undefined) {
    const commit = resolvedGitHubCommit(profileDir, plugin.name)
    if (commit === undefined) throw new Error('Installed the GitHub repository but could not pin its resolved commit')
    const pinnedSpec = `github:${normalized.repository}#${commit}`
    const buildArguments = allowBuildScripts ? [`--allow-build=${githubBuildKey(plugin.name, normalized)}`] : ['--ignore-scripts']
    await runPnpmImpl({
      args: ['add', '--save-prod', '--reporter', 'append-only', ...buildArguments, pinnedSpec],
      env,
      execPath,
      onOutput,
      pnpmEntry,
      profileDir,
      signal,
    })
    catalog = readPluginCatalog({ dshHome, profile })
    plugin = catalog.plugins.find(candidate => candidate.name === plugin.name)
  }
  const requiredBuildScriptsIgnored = buildScriptsIgnored && plugin !== undefined
    && installedPluginRequiresBuild(profileDir, plugin.name)
  if (plugin?.bundle && (!requiredBuildScriptsIgnored || allowBuildScripts)) {
    setPluginEnabled({ dshHome, name: plugin.name, enabled: true, profile })
  }
  return {
    ...readPluginCatalog({ dshHome, profile }),
    buildScriptsIgnored: requiredBuildScriptsIgnored && !allowBuildScripts,
  }
}

export async function removePlugin({
  dshHome,
  pnpmEntry,
  name,
  execPath,
  env,
  onOutput,
  signal,
  profile = PLUGIN_PROFILE,
  runPnpmImpl = runPnpm,
}) {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('Invalid plugin package name')
  if (SYSTEM_BUNDLES.has(name)) throw new Error('System bundles cannot be removed')
  const catalog = readPluginCatalog({ dshHome, profile })
  const plugin = catalog.plugins.find(candidate => candidate.name === name)
  if (plugin === undefined) throw new Error('Plugin is not installed')
  await runPnpmImpl({
    args: ['remove', '--reporter', 'append-only', name],
    env,
    execPath,
    onOutput,
    pnpmEntry,
    profileDir: catalog.profileDir,
    signal,
  })
  forgetGitHubBuildPermission(catalog.profileDir, plugin)
  forgetPluginBundle({ dshHome, name, profile })
  return readPluginCatalog({ dshHome, profile })
}
