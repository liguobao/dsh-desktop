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
const GITHUB_OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i
const GITHUB_REPOSITORY_PATTERN = /^[a-z0-9._-]+$/i
const GITHUB_REF_PATTERN = /^[a-z0-9][a-z0-9._\/-]{0,127}$/i
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

function normalizeGitHubRef(value) {
  if (value === undefined) return undefined
  if (!GITHUB_REF_PATTERN.test(value) || value.includes('..') || value.includes('//') || value.endsWith('/')) {
    throw new Error('Invalid GitHub revision')
  }
  return value
}

function decodeGitHubUrlPart(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('Use a GitHub repository, commit, or tree address')
  }
}

function githubUrlRef(segments, hash) {
  const route = segments.slice(2)
  if (route.length === 0) {
    return hash === '' ? undefined : normalizeGitHubRef(decodeGitHubUrlPart(hash.slice(1)))
  }
  if (route[0].toLowerCase() === 'commit' && route.length === 2 && /^[a-f0-9]{7,40}$/i.test(route[1])) {
    return route[1]
  }
  if (route[0].toLowerCase() === 'tree' && route.length >= 2) {
    return normalizeGitHubRef(route.slice(1).join('/'))
  }
  if (route[0].toLowerCase() === 'releases' && route[1]?.toLowerCase() === 'tag' && route.length >= 3) {
    return normalizeGitHubRef(route.slice(2).join('/'))
  }
  throw new Error('Use a GitHub repository, commit, or tree address')
}

function githubSource(spec) {
  if (spec.toLowerCase().startsWith('github:')) {
    const source = spec.slice('github:'.length)
    const hashAt = source.indexOf('#')
    const path = hashAt === -1 ? source : source.slice(0, hashAt)
    const ref = hashAt === -1 ? undefined : source.slice(hashAt + 1)
    const segments = path.split('/')
    if (segments.length !== 2) throw new Error('Use a GitHub repository address')
    const owner = segments[0]
    const repository = segments[1].replace(/\.git$/i, '')
    if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_REPOSITORY_PATTERN.test(repository)) {
      throw new Error('Use a GitHub repository address')
    }
    return { owner, repository, ref: normalizeGitHubRef(ref) }
  }

  if (!/^(?:git\+)?https:\/\/github\.com\//i.test(spec)) return undefined
  let url
  try {
    url = new URL(spec.replace(/^git\+/i, ''))
  } catch {
    throw new Error('Use a GitHub repository address')
  }
  const segments = url.pathname.split('/').filter(Boolean).map(decodeGitHubUrlPart)
  const owner = segments[0]
  const repository = segments[1]?.replace(/\.git$/i, '')
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'github.com'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
    || segments.length < 2
    || !GITHUB_OWNER_PATTERN.test(owner ?? '')
    || !GITHUB_REPOSITORY_PATTERN.test(repository ?? '')
  ) {
    throw new Error('Use a GitHub repository, commit, or tree address')
  }
  return { owner, repository, ref: githubUrlRef(segments, url.hash) }
}

export function normalizePluginSpec(value) {
  if (typeof value !== 'string') throw new Error('Plugin package is required')
  const spec = value.trim()
  if (spec.length === 0) throw new Error('Plugin package is required')
  if (spec.length > MAX_PLUGIN_SPEC_LENGTH) throw new Error('Plugin package is too long')
  if (/\s|[\0\r\n]/.test(spec) || spec.startsWith('-')) throw new Error('Invalid plugin package')

  const github = githubSource(spec)
  if (github !== undefined) {
    const { owner, repository, ref } = github
    return {
      spec: `github:${owner}/${repository}${ref === undefined ? '' : `#${ref}`}`,
      source: 'github',
      repository: `${owner}/${repository}`,
      ...(ref === undefined ? {} : { ref }),
    }
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

export function runGit({
  args,
  cwd,
  env = process.env,
  signal,
  spawnImpl = nodeSpawn,
  onOutput = () => {},
}) {
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
    return Promise.reject(new Error('Invalid git arguments'))
  }
  return new Promise((resolve, reject) => {
    const child = spawnImpl('git', args, {
      cwd,
      env: {
        ...env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
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
    child.once('error', (error) => {
      if (error?.code === 'ENOENT') reject(new Error('Git is required to install or update GitHub plugins'))
      else reject(error)
    })
    child.once('exit', (code, signal) => {
      if (code === 0) resolve({ output })
      else {
        const detail = output.trim() || `git exited with code ${String(code)} and signal ${String(signal)}`
        reject(new Error(detail))
      }
    })
  })
}

function githubRemote(normalized) {
  return `https://github.com/${normalized.repository}.git`
}

async function resolveLatestGitHubTag({ normalized, cwd, env, onOutput, signal, runGitImpl }) {
  const result = await runGitImpl({
    args: ['ls-remote', '--tags', '--refs', '--sort=-version:refname', githubRemote(normalized)],
    cwd,
    env,
    onOutput,
    signal,
  })
  for (const line of result.output.split(/\r?\n/)) {
    const match = /^[a-f0-9]{40}\s+refs\/tags\/(.+)$/i.exec(line)
    if (match === null) continue
    const ref = normalizeGitHubRef(match[1])
    return { ...normalized, ref, spec: `github:${normalized.repository}#${ref}` }
  }
  throw new Error('The GitHub repository has no tags')
}

async function resolveGitHubDefaultCommit({ normalized, cwd, env, onOutput, signal, runGitImpl }) {
  const result = await runGitImpl({
    args: ['ls-remote', '--symref', githubRemote(normalized), 'HEAD'],
    cwd,
    env,
    onOutput,
    signal,
  })
  for (const line of result.output.split(/\r?\n/)) {
    const match = /^([a-f0-9]{40})\s+HEAD$/i.exec(line)
    if (match !== null) return match[1].toLowerCase()
  }
  throw new Error('Could not resolve the GitHub repository default branch')
}

function findInstalledPlugin(catalog, previous, normalized) {
  if (normalized.source === 'npm') {
    return catalog.plugins.find(candidate => candidate.name === normalized.packageName)
  }
  const repositoryMatches = catalog.plugins.filter(candidate => pluginUsesGitHubRepository(candidate, normalized.repository))
  if (repositoryMatches.length === 1) return repositoryMatches[0]
  const changed = catalog.plugins.filter(candidate => previous.get(candidate.name) !== candidate.requested)
  return changed.length === 1 ? changed[0] : undefined
}

function pluginUsesGitHubRepository(plugin, repository) {
  try {
    const source = normalizePluginSpec(plugin.requested)
    return source.source === 'github' && source.repository.toLowerCase() === repository.toLowerCase()
  } catch {
    return false
  }
}

function githubBuildKey(packageName, normalized) {
  return `${packageName}@git+https://github.com/${normalized.repository}.git`
}

function githubBuildAllowed(profileDir, plugin, normalized) {
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) return false
  const workspace = parse(readFileSync(workspacePath, 'utf8'))
  if (typeof workspace !== 'object' || workspace === null || Array.isArray(workspace)) return false
  if (typeof workspace.allowBuilds !== 'object' || workspace.allowBuilds === null || Array.isArray(workspace.allowBuilds)) return false
  return workspace.allowBuilds[githubBuildKey(plugin.name, normalized)] === true
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
  runGitImpl = runGit,
  runPnpmImpl = runPnpm,
}) {
  if (typeof allowBuildScripts !== 'boolean') throw new Error('Invalid build-script permission')
  let normalized = normalizePluginSpec(spec)
  const profileDir = profileDirectory(dshHome, profile)
  if (normalized.source === 'github' && normalized.ref === undefined) {
    normalized = await resolveLatestGitHubTag({ normalized, cwd: profileDir, env, onOutput, signal, runGitImpl })
  }
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
    const installedName = plugin.name
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
    plugin = catalog.plugins.find(candidate => candidate.name === installedName)
    if (plugin === undefined) throw new Error('Pinned the GitHub repository but its package is no longer installed')
    const superseded = catalog.plugins.filter(candidate =>
      candidate.name !== installedName
      && previous.has(candidate.name)
      && pluginUsesGitHubRepository(candidate, normalized.repository),
    )
    if (superseded.length > 0) {
      await runPnpmImpl({
        args: ['remove', '--reporter', 'append-only', ...superseded.map(candidate => candidate.name)],
        env,
        execPath,
        onOutput,
        pnpmEntry,
        profileDir,
        signal,
      })
      for (const candidate of superseded) {
        forgetGitHubBuildPermission(profileDir, candidate)
        forgetPluginBundle({ dshHome, name: candidate.name, profile })
      }
      catalog = readPluginCatalog({ dshHome, profile })
      plugin = catalog.plugins.find(candidate => candidate.name === installedName)
      if (plugin === undefined) throw new Error('Removed the superseded plugin but the replacement is missing')
    }
  }
  const requiredBuildScriptsIgnored = buildScriptsIgnored && plugin !== undefined
    && installedPluginRequiresBuild(profileDir, plugin.name)
  if (plugin?.bundle) {
    setPluginEnabled({
      dshHome,
      name: plugin.name,
      enabled: !requiredBuildScriptsIgnored || allowBuildScripts,
      profile,
    })
  }
  return {
    ...readPluginCatalog({ dshHome, profile }),
    buildScriptsIgnored: requiredBuildScriptsIgnored && !allowBuildScripts,
  }
}

export async function updatePlugin({
  dshHome,
  pnpmEntry,
  name,
  execPath,
  env,
  onOutput,
  signal,
  profile = PLUGIN_PROFILE,
  runGitImpl = runGit,
  runPnpmImpl = runPnpm,
}) {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('Invalid plugin package name')
  if (SYSTEM_BUNDLES.has(name)) throw new Error('System bundles cannot be updated')
  const before = readPluginCatalog({ dshHome, profile })
  const plugin = before.plugins.find(candidate => candidate.name === name)
  if (plugin === undefined) throw new Error('Plugin is not installed')
  const normalized = normalizePluginSpec(plugin.requested)
  if (normalized.source !== 'github') throw new Error('Only GitHub plugins support online updates')
  const commit = await resolveGitHubDefaultCommit({
    normalized,
    cwd: before.profileDir,
    env,
    onOutput,
    signal,
    runGitImpl,
  })
  if (normalized.ref?.toLowerCase() === commit) return { ...before, upToDate: true }

  const wasEnabled = plugin.enabled
  const result = await installPlugin({
    dshHome,
    pnpmEntry,
    spec: `github:${normalized.repository}#${commit}`,
    allowBuildScripts: githubBuildAllowed(before.profileDir, plugin, normalized),
    execPath,
    env,
    onOutput,
    signal,
    profile,
    runGitImpl,
    runPnpmImpl,
  })
  let catalog = readPluginCatalog({ dshHome, profile })
  const updated = catalog.plugins.find(candidate => pluginUsesGitHubRepository(candidate, normalized.repository))
  if (!wasEnabled && updated?.bundle && updated.enabled) {
    setPluginEnabled({ dshHome, name: updated.name, enabled: false, profile })
    catalog = readPluginCatalog({ dshHome, profile })
  }
  return {
    ...catalog,
    buildScriptsIgnored: result.buildScriptsIgnored,
    upToDate: false,
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
