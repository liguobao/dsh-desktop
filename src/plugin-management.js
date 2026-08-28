import { spawn as nodeSpawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { cp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import semver from 'semver'
import { parse, stringify } from 'yaml'

export const PLUGIN_PROFILE = 'web'
export const MAX_PLUGIN_SPEC_LENGTH = 300
export const MAX_PLUGIN_OUTPUT_LENGTH = 64 * 1024
export const SYSTEM_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
const PLUGIN_INSTALL_HISTORY = '.dsh-desktop-plugin-history.json'
const DEFAULT_PLUGIN_STATE = '.dsh-desktop-default-plugins.json'
const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org/'
const MAX_NPM_VERSION_RESPONSE_LENGTH = 64 * 1024

export const BUNDLED_REMOTE_SPEC = 'ds-harness-remote@0.4.1'
export const BUNDLED_FILE_VIEWER_SPEC = 'dsh-file-viewer@0.3.1'
/** Optional online defaults. Desktop-bundled plugins are prepared locally before Harness starts. */
export const DEFAULT_PLUGINS = []
const DEFAULT_PLUGIN_SEEN_ALIASES = new Map([
  ['npm:ds-harness-remote', ['github:liguobao/deepseek-harness-remote']],
  ['npm:dsh-file-viewer', ['github:liguobao/dsh-file-viewer']],
])
const LEGACY_BUNDLED_REMOTE_SPECS = new Set([
  '0.4.0',
  'github:liguobao/deepseek-harness-remote#3f8bd3b17f84fc6d8e04adabe2b078b1bbcd88e2',
  'github:liguobao/deepseek-harness-remote#v0.3.34',
  'github:liguobao/deepseek-harness-remote#3e96c7e9c36b05c39651669eb9d20fe6fb77ad4e',
  'github:liguobao/deepseek-harness-remote#v0.3.33',
  'github:liguobao/deepseek-harness-remote#4cf5abf515a82603ce68374e7ac80a3e1f27b9eb',
  'github:liguobao/deepseek-harness-remote#v0.3.32',
  'github:liguobao/deepseek-harness-remote#ae70ff87afd0ac176f0f4105b23a417a97a1dd04',
  'github:liguobao/deepseek-harness-remote#v0.3.31',
  'github:liguobao/deepseek-harness-remote#c0cb1a9e5376dd3974b212e1897dd62c532bd9b4',
  'github:liguobao/deepseek-harness-remote#0243b35ba19b506565650322e1d29236c45e7098',
  'github:liguobao/deepseek-harness-remote#v0.3.30',
  'github:liguobao/deepseek-harness-remote#1acd5f49563fe7dfbad221e0293ea7be2ea05a19',
  'github:liguobao/deepseek-harness-remote#c049c8eb669765f82f90266c9f9c3a0166a7d734',
  'github:liguobao/deepseek-harness-remote#v0.3.23',
  'github:liguobao/deepseek-harness-remote#9df2052098ee264edc0d0b9245367a063458c81e',
  'github:liguobao/deepseek-harness-remote#v0.3.21',
  'github:liguobao/deepseek-harness-remote#5f5e8dfa7f0f7a9f45c1e6165ba23fd28b577d6d',
  'github:liguobao/deepseek-harness-remote#v0.3.20',
  'github:liguobao/deepseek-harness-remote#v0.3.19',
  'github:liguobao/deepseek-harness-remote#v0.3.18',
  'github:liguobao/deepseek-harness-remote#4e4ab9e0162273b5c3eb3a8bbb90929ec58c2a7c',
  'github:liguobao/deepseek-harness-remote#599bd5a4d14b980c8101575eca5c36a12007a2f8',
  'github:liguobao/deepseek-harness-remote#633bf08f9bac174fc6dbe37738786ebb83421c24',
  'github:liguobao/deepseek-harness-remote#3a271eaeaa649647ec27e137fb7321526799a749',
  'github:liguobao/deepseek-harness-remote#a4826a4e48008adcbc15d7f075926657d87629e0',
  'github:liguobao/deepseek-harness-remote#da4beadabb57096a66b3ca790fd85a340a0ca899',
])
const LEGACY_BUNDLED_FILE_VIEWER_SPECS = new Set([
  '0.3.0',
  'github:liguobao/dsh-file-viewer#b28be6bad250a6bd52c81b3609faa88d2de10c39',
  'github:liguobao/dsh-file-viewer#v0.2.5',
  'github:liguobao/dsh-file-viewer#7fbfc7b8092c6ca1935b19b7563761a5600df522',
  'github:liguobao/dsh-file-viewer#v0.2.4',
  'github:liguobao/dsh-file-viewer#v0.2.3',
  'github:liguobao/dsh-file-viewer#eacc407e205ffa4a37fbc36b0b99927a4ad68020',
  'github:liguobao/dsh-file-viewer#v0.2.2',
  'github:liguobao/dsh-file-viewer#v0.2.1',
  'github:liguobao/dsh-file-viewer#ed2f9ede3ada97145b3701aa8a09f45fc229f53f',
  'github:liguobao/dsh-file-viewer#a4d6e2cbf6424a47f93d735070741df391d5ede4',
  'github:liguobao/dsh-file-viewer#605cd34b9e96ad7775f37493b701a601b97efeee',
  'github:liguobao/dsh-file-viewer#4295572d3192fd4685aeda42b34a7ddb4b793754',
  '0.1.3',
])

const PROFILE_SYSTEM_BUNDLES = { web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] }
const PROFILE_PNPM_WORKSPACE = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const PACKAGE_SELECTOR_PATTERN = /^[a-z0-9~^*<>=|+_.-]+$/i
const GITHUB_OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i
const GITHUB_REPOSITORY_PATTERN = /^[a-z0-9._-]+$/i
const GITHUB_REF_PATTERN = /^[a-z0-9][a-z0-9._\/-]{0,127}$/i
const GITHUB_PACKAGE_PATH_PATTERN = /^\/[a-z0-9][a-z0-9._\/-]{0,255}$/i
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

function readPluginInstallHistory(profileDir) {
  try {
    const value = readJson(join(profileDir, PLUGIN_INSTALL_HISTORY))
    if (value?.version !== 1 || typeof value.installedAt !== 'object' || value.installedAt === null || Array.isArray(value.installedAt)) return {}
    return Object.fromEntries(Object.entries(value.installedAt).filter(([name, timestamp]) =>
      PACKAGE_NAME_PATTERN.test(name) && typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)),
    ))
  } catch {
    return {}
  }
}

function recordPluginInstalled(profileDir, name) {
  const installedAt = readPluginInstallHistory(profileDir)
  installedAt[name] = new Date().toISOString()
  writeJsonAtomic(join(profileDir, PLUGIN_INSTALL_HISTORY), { version: 1, installedAt })
}

function forgetPluginInstallHistory(profileDir, name) {
  const installedAt = readPluginInstallHistory(profileDir)
  if (!Object.hasOwn(installedAt, name)) return
  delete installedAt[name]
  writeJsonAtomic(join(profileDir, PLUGIN_INSTALL_HISTORY), { version: 1, installedAt })
}

function readDefaultPluginState(profileDir) {
  try {
    const value = readJson(join(profileDir, DEFAULT_PLUGIN_STATE))
    if (value?.version !== 1 || !Array.isArray(value.seen)) return { version: 1, seen: [] }
    return {
      version: 1,
      seen: value.seen.filter(key => typeof key === 'string' && key.length > 0 && key.length <= MAX_PLUGIN_SPEC_LENGTH),
    }
  } catch {
    return { version: 1, seen: [] }
  }
}

function writeDefaultPluginState(profileDir, state) {
  writeJsonAtomic(join(profileDir, DEFAULT_PLUGIN_STATE), state)
}

function defaultPluginKey(normalized) {
  return normalized.source === 'github'
    ? `github:${normalized.repository.toLowerCase()}${normalized.path === undefined ? '' : `#path:${normalized.path}`}`
    : `npm:${normalized.packageName}`
}

function defaultPluginAlreadySeen(seen, key) {
  return seen.has(key) || (DEFAULT_PLUGIN_SEEN_ALIASES.get(key) ?? []).some(alias => seen.has(alias))
}

function shortCommitRef(ref) {
  return typeof ref === 'string' && /^[a-f0-9]{7,39}$/i.test(ref)
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

function pluginMetadata(profileDir, packageName, requested, enabled, installedAt) {
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
    ...(installedAt === undefined ? {} : { installedAt }),
    bundle,
    enabled: bundle && enabled,
  }
}

export function profileDirectory(dshHome, profile = PLUGIN_PROFILE) {
  return join(dshHome, 'profiles', profile)
}

/**
 * Initialize a profile directory the same way the Harness does before its
 * first boot, so default plugins can install into a well-formed profile.
 * Existing files are never touched, so this is a no-op on an initialized
 * profile and never overrides a user-owned manifest.
 */
export function ensureProfileInitialized(dshHome, profile = PLUGIN_PROFILE) {
  const profileDir = profileDirectory(dshHome, profile)
  mkdirSync(profileDir, { recursive: true })
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) {
    writeJsonAtomic(manifestPath, {
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...(PROFILE_SYSTEM_BUNDLES[profile] ?? ['@deepseek-ai/dsh-base'])] } },
    })
  }
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeTextAtomic(workspacePath, PROFILE_PNPM_WORKSPACE)
  return profileDir
}

function dependencyDirectory(sourceDir, name) {
  const parts = name.split('/')
  let current = sourceDir
  while (true) {
    const candidate = join(current, 'node_modules', ...parts)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function bundledDependencyClosure(sourceDir) {
  const packages = new Map()
  const visit = (directory) => {
    const manifest = readJson(join(directory, 'package.json'))
    if (packages.has(manifest.name)) return
    packages.set(manifest.name, directory)
    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies }
    for (const name of Object.keys(dependencies)) {
      const dependency = dependencyDirectory(directory, name)
      if (dependency !== undefined) visit(dependency)
    }
  }
  visit(sourceDir)
  return packages
}

function bundledPluginFilesAvailable(directory, manifest) {
  return [manifest.main, manifest.dsh?.bundle?.patch].every(path =>
    typeof path !== 'string' || path.trim() === '' || existsSync(join(directory, path)),
  )
}

/** Seed a prebuilt bundled plugin and its runtime dependency closure without network access. */
export async function installBundledPlugin({
  dshHome,
  sourceDir,
  profile = PLUGIN_PROFILE,
  spec,
  packageName,
  legacySpecs = new Set(),
  legacyPackageNames = [],
}) {
  const profileDir = ensureProfileInitialized(dshHome, profile)
  const manifestPath = join(profileDir, 'package.json')
  const profileManifest = readJson(manifestPath)
  const sourceManifest = readJson(join(sourceDir, 'package.json'))
  const normalized = normalizePluginSpec(spec)
  if (sourceManifest.name !== packageName || sourceManifest.dsh?.bundle?.patch === undefined) {
    throw new Error(`Bundled plugin ${packageName} is invalid`)
  }
  let dependencySpecifier
  let lockVersion
  if (normalized.source === 'github') {
    if (normalized.ref === undefined) throw new Error(`Bundled plugin ${packageName} must pin a GitHub revision`)
    dependencySpecifier = spec
    lockVersion = `https://codeload.github.com/${normalized.repository}/tar.gz/${normalized.ref}`
  } else {
    if (normalized.packageName !== packageName || normalized.spec !== `${packageName}@${sourceManifest.version}`) {
      throw new Error(`Bundled plugin ${packageName} must pin its packaged npm version`)
    }
    dependencySpecifier = sourceManifest.version
    lockVersion = sourceManifest.version
  }

  const legacyPackageSet = new Set(legacyPackageNames.filter(name =>
    name !== packageName && typeof name === 'string' && PACKAGE_NAME_PATTERN.test(name),
  ))
  for (const legacyPackageName of legacyPackageSet) {
    const declaredSpec = profileManifest.dependencies?.[legacyPackageName]
    if (typeof declaredSpec !== 'string' || !legacySpecs.has(declaredSpec)) continue
    delete profileManifest.dependencies[legacyPackageName]
    const bundles = Array.isArray(profileManifest.dsh?.profile?.bundles) ? profileManifest.dsh.profile.bundles : []
    profileManifest.dsh = {
      ...profileManifest.dsh,
      profile: { ...profileManifest.dsh?.profile, bundles: bundles.filter(name => name !== legacyPackageName) },
    }
    await rm(join(profileDir, 'node_modules', ...legacyPackageName.split('/')), { recursive: true, force: true })
  }

  const targetPlugin = join(profileDir, 'node_modules', ...packageName.split('/'))
  const declared = Object.hasOwn(profileManifest.dependencies ?? {}, packageName)
  if (declared && existsSync(join(targetPlugin, 'package.json'))) {
    const declaredSpec = profileManifest.dependencies[packageName]
    const needsMigration = legacySpecs.has(declaredSpec)
      || (normalized.source === 'npm'
        && semver.valid(declaredSpec) === declaredSpec
        && semver.valid(sourceManifest.version) === sourceManifest.version
        && semver.lt(declaredSpec, sourceManifest.version))
    const needsBundledRepair = declaredSpec === dependencySpecifier
      && !bundledPluginFilesAvailable(targetPlugin, sourceManifest)
    if (!needsMigration && !needsBundledRepair) return targetPlugin
    await rm(targetPlugin, { recursive: true, force: true })
  }
  if (!existsSync(join(targetPlugin, 'package.json'))) {
    for (const [name, directory] of bundledDependencyClosure(sourceDir)) {
      const target = join(profileDir, 'node_modules', ...name.split('/'))
      if (!existsSync(join(target, 'package.json'))) await cp(directory, target, { recursive: true, dereference: true })
    }
  }

  profileManifest.dependencies = { ...profileManifest.dependencies, [packageName]: dependencySpecifier }
  const bundles = Array.isArray(profileManifest.dsh?.profile?.bundles) ? profileManifest.dsh.profile.bundles : []
  profileManifest.dsh = {
    ...profileManifest.dsh,
    profile: {
      ...profileManifest.dsh?.profile,
      bundles: bundles.includes(packageName) ? bundles : [...bundles, packageName],
    },
  }
  writeJsonAtomic(manifestPath, profileManifest)

  const lockPath = join(profileDir, 'pnpm-lock.yaml')
  const lockfile = existsSync(lockPath) ? parse(readFileSync(lockPath, 'utf8')) : { lockfileVersion: '9.0', importers: {} }
  lockfile.importers ??= {}
  lockfile.importers['.'] ??= {}
  lockfile.importers['.'].dependencies ??= {}
  for (const legacyPackageName of legacyPackageSet) delete lockfile.importers['.'].dependencies[legacyPackageName]
  lockfile.importers['.'].dependencies[packageName] = {
    specifier: dependencySpecifier,
    version: lockVersion,
  }
  writeTextAtomic(lockPath, stringify(lockfile))
  return targetPlugin
}

/** Seed the prebuilt remote plugin and its runtime dependency closure without network access. */
export function installBundledRemotePlugin(options) {
  return installBundledPlugin({
    ...options,
    packageName: 'ds-harness-remote',
    spec: options.spec ?? BUNDLED_REMOTE_SPEC,
    legacySpecs: LEGACY_BUNDLED_REMOTE_SPECS,
    legacyPackageNames: ['dsh-remote', 'deepseek-harness-remote'],
  })
}

/** Seed the prebuilt file-viewer release and migrate superseded bundled sources. */
export function installBundledFileViewerPlugin(options) {
  return installBundledPlugin({
    ...options,
    packageName: 'dsh-file-viewer',
    spec: options.spec ?? BUNDLED_FILE_VIEWER_SPEC,
    legacySpecs: LEGACY_BUNDLED_FILE_VIEWER_SPECS,
  })
}

function normalizeGitHubRef(value) {
  if (value === undefined) return undefined
  if (!GITHUB_REF_PATTERN.test(value) || value.includes('..') || value.includes('//') || value.endsWith('/')) {
    throw new Error('Invalid GitHub revision')
  }
  return value
}

function normalizeGitHubPackagePath(value) {
  if (
    typeof value !== 'string'
    || !GITHUB_PACKAGE_PATH_PATTERN.test(value)
    || value.includes('..')
    || value.includes('//')
    || value.endsWith('/')
  ) {
    throw new Error('Invalid GitHub package path')
  }
  return value
}

function githubSelector(value) {
  if (value === undefined || value === '') return {}
  if (value.startsWith('path:')) return { path: normalizeGitHubPackagePath(value.slice('path:'.length)) }
  const pathAt = value.indexOf('&path:')
  if (pathAt === -1) return { ref: normalizeGitHubRef(value) }
  return {
    ref: normalizeGitHubRef(value.slice(0, pathAt)),
    path: normalizeGitHubPackagePath(value.slice(pathAt + '&path:'.length)),
  }
}

function normalizedGitHubSpec({ repository, ref, path }) {
  const selector = ref === undefined
    ? path === undefined ? '' : `path:${path}`
    : `${ref}${path === undefined ? '' : `&path:${path}`}`
  return `github:${repository}${selector === '' ? '' : `#${selector}`}`
}

function decodeGitHubUrlPart(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('Use a GitHub repository, commit, or tree address')
  }
}

function githubUrlSelector(segments, hash) {
  const route = segments.slice(2)
  if (route.length === 0) {
    return githubSelector(hash === '' ? undefined : decodeGitHubUrlPart(hash.slice(1)))
  }
  if (route[0].toLowerCase() === 'commit' && route.length === 2 && /^[a-f0-9]{7,40}$/i.test(route[1])) {
    return { ref: route[1] }
  }
  if (route[0].toLowerCase() === 'tree' && route.length >= 2) {
    return { ref: normalizeGitHubRef(route.slice(1).join('/')) }
  }
  if (route[0].toLowerCase() === 'releases' && route[1]?.toLowerCase() === 'tag' && route.length >= 3) {
    return { ref: normalizeGitHubRef(route.slice(2).join('/')) }
  }
  throw new Error('Use a GitHub repository, commit, or tree address')
}

function githubSource(spec) {
  if (spec.toLowerCase().startsWith('github:')) {
    const source = spec.slice('github:'.length)
    const hashAt = source.indexOf('#')
    const path = hashAt === -1 ? source : source.slice(0, hashAt)
    const selector = githubSelector(hashAt === -1 ? undefined : source.slice(hashAt + 1))
    const segments = path.split('/')
    if (segments.length !== 2) throw new Error('Use a GitHub repository address')
    const owner = segments[0]
    const repository = segments[1].replace(/\.git$/i, '')
    if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_REPOSITORY_PATTERN.test(repository)) {
      throw new Error('Use a GitHub repository address')
    }
    return { owner, repository, ...selector }
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
  return { owner, repository, ...githubUrlSelector(segments, url.hash) }
}

export function normalizePluginSpec(value) {
  if (typeof value !== 'string') throw new Error('Plugin package is required')
  const spec = value.trim()
  if (spec.length === 0) throw new Error('Plugin package is required')
  if (spec.length > MAX_PLUGIN_SPEC_LENGTH) throw new Error('Plugin package is too long')
  if (/\s|[\0\r\n]/.test(spec) || spec.startsWith('-')) throw new Error('Invalid plugin package')

  const github = githubSource(spec)
  if (github !== undefined) {
    const { owner, repository, ref, path } = github
    const qualifiedRepository = `${owner}/${repository}`
    return {
      spec: normalizedGitHubSpec({ repository: qualifiedRepository, ref, path }),
      source: 'github',
      repository: qualifiedRepository,
      ...(ref === undefined ? {} : { ref }),
      ...(path === undefined ? {} : { path }),
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
  const installedAt = readPluginInstallHistory(profileDir)
  const dependencyNames = new Set(Object.keys(dependencies).filter(name => !SYSTEM_BUNDLES.has(name)))
  const plugins = Object.entries(dependencies).filter(([name]) => !SYSTEM_BUNDLES.has(name)).map(([name, requested]) =>
    pluginMetadata(profileDir, name, typeof requested === 'string' ? requested : '', bundles.includes(name), installedAt[name]),
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

async function resolveLatestGitHubRevision({ normalized, cwd, env, onOutput, signal, runGitImpl }) {
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
    return { ...normalized, ref, spec: normalizedGitHubSpec({ ...normalized, ref }) }
  }
  const ref = await resolveGitHubDefaultCommit({ normalized, cwd, env, onOutput, signal, runGitImpl })
  return { ...normalized, ref, spec: normalizedGitHubSpec({ ...normalized, ref }) }
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

function npmRegistryFromOutput(output) {
  for (const line of output.split(/\r?\n/).map(line => line.trim()).reverse()) {
    try {
      const url = new URL(line)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url
    } catch {
      // pnpm can print warnings before the configured registry URL.
    }
  }
  return new URL(DEFAULT_NPM_REGISTRY)
}

async function resolveLatestNpmVersion({
  packageName,
  env,
  execPath,
  fetchImpl,
  onOutput,
  pnpmEntry,
  profileDir,
  signal,
  runPnpmImpl,
}) {
  // pnpm 9 forwards `view`/`info` to a separately installed npm executable.
  // Finder-launched macOS apps do not have the user's shell PATH, so ask pnpm
  // only for its registry setting and fetch the small `latest` document here.
  const registryResult = await runPnpmImpl({
    args: ['config', 'get', 'registry'],
    env,
    execPath,
    onOutput,
    pnpmEntry,
    profileDir,
    signal,
  })
  const registry = npmRegistryFromOutput(registryResult.output)
  if (!registry.pathname.endsWith('/')) registry.pathname += '/'
  const responseUrl = new URL(`${encodeURIComponent(packageName)}/latest`, registry)
  const response = await fetchImpl(responseUrl, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-desktop-plugin-manager' },
    redirect: 'error',
    signal,
  })
  if (!response.ok) throw new Error(`npm registry request failed (${String(response.status)})`)
  const contentLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_NPM_VERSION_RESPONSE_LENGTH) {
    throw new Error('npm registry response is too large')
  }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_NPM_VERSION_RESPONSE_LENGTH) {
    throw new Error('npm registry response is too large')
  }
  const version = semver.valid(JSON.parse(text)?.version)
  if (version === null) throw new Error('Could not resolve the npm package latest version')
  return version
}

function findInstalledPlugin(catalog, previous, normalized) {
  if (normalized.source === 'npm') {
    return catalog.plugins.find(candidate => candidate.name === normalized.packageName)
  }
  const repositoryMatches = catalog.plugins.filter(candidate => pluginUsesGitHubSource(candidate, normalized))
  if (repositoryMatches.length === 1) return repositoryMatches[0]
  const changed = catalog.plugins.filter(candidate => previous.get(candidate.name) !== candidate.requested)
  return changed.length === 1 ? changed[0] : undefined
}

function pluginUsesGitHubSource(plugin, normalized) {
  try {
    const source = normalizePluginSpec(plugin.requested)
    return source.source === 'github'
      && source.repository.toLowerCase() === normalized.repository.toLowerCase()
      && source.path === normalized.path
  } catch {
    return false
  }
}

function writeProfileDependencySpecifier(profileDir, packageName, spec) {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = readJson(manifestPath)
  if (manifest.dependencies?.[packageName] === spec) return
  manifest.dependencies = { ...manifest.dependencies, [packageName]: spec }
  writeJsonAtomic(manifestPath, manifest)
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
  return /(?:\/tar\.gz\/|#)([a-f0-9]{40})(?:$|[?&(])/i.exec(resolution)?.[1]
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
  if (normalized.source === 'github' && shortCommitRef(normalized.ref)) {
    throw new Error('Short Git commit hashes are not supported; use the full 40-character SHA')
  }
  const profileDir = profileDirectory(dshHome, profile)
  if (normalized.source === 'github' && normalized.ref === undefined) {
    normalized = await resolveLatestGitHubRevision({ normalized, cwd: profileDir, env, onOutput, signal, runGitImpl })
  }
  const before = readPluginCatalog({ dshHome, profile })
  const previous = new Map(before.plugins.map(plugin => [plugin.name, plugin.requested]))
  const firstInstall = await runPnpmImpl({
    args: [
      'add',
      '--workspace-root',
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
    const pinnedSpec = normalizedGitHubSpec({ ...normalized, ref: commit })
    const buildArguments = allowBuildScripts ? [`--allow-build=${githubBuildKey(plugin.name, normalized)}`] : ['--ignore-scripts']
    await runPnpmImpl({
      args: ['add', '--workspace-root', '--save-prod', '--reporter', 'append-only', ...buildArguments, pinnedSpec],
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
      && pluginUsesGitHubSource(candidate, normalized),
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
        forgetPluginInstallHistory(profileDir, candidate.name)
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
  if (plugin !== undefined && !previous.has(plugin.name)) recordPluginInstalled(profileDir, plugin.name)
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
  fetchImpl = globalThis.fetch,
  runGitImpl = runGit,
  runPnpmImpl = runPnpm,
}) {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('Invalid plugin package name')
  if (SYSTEM_BUNDLES.has(name)) throw new Error('System bundles cannot be updated')
  const before = readPluginCatalog({ dshHome, profile })
  const plugin = before.plugins.find(candidate => candidate.name === name)
  if (plugin === undefined) throw new Error('Plugin is not installed')
  if (plugin.source !== 'github') {
    const latestVersion = await resolveLatestNpmVersion({
      packageName: plugin.name,
      env,
      execPath,
      fetchImpl,
      onOutput,
      pnpmEntry,
      profileDir: before.profileDir,
      signal,
      runPnpmImpl,
    })
    const currentVersion = semver.valid(plugin.version)
    const normalizedLatestVersion = semver.valid(latestVersion)
    if (
      plugin.version === latestVersion
      || (currentVersion !== null && normalizedLatestVersion !== null && semver.gte(currentVersion, normalizedLatestVersion))
    ) return { ...before, upToDate: true }

    const wasEnabled = plugin.enabled
    const result = await installPlugin({
      dshHome,
      pnpmEntry,
      spec: `${plugin.name}@${latestVersion}`,
      execPath,
      env,
      onOutput,
      signal,
      profile,
      runGitImpl,
      runPnpmImpl,
    })
    let catalog = readPluginCatalog({ dshHome, profile })
    const updated = catalog.plugins.find(candidate => candidate.name === plugin.name)
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

  const normalized = normalizePluginSpec(plugin.requested)
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
  const targetSpec = normalizedGitHubSpec({ ...normalized, ref: commit })
  writeProfileDependencySpecifier(before.profileDir, plugin.name, targetSpec)
  const result = await installPlugin({
    dshHome,
    pnpmEntry,
    spec: targetSpec,
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
  const updated = catalog.plugins.find(candidate => pluginUsesGitHubSource(candidate, normalized))
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
  forgetPluginInstallHistory(catalog.profileDir, name)
  return readPluginCatalog({ dshHome, profile })
}

/**
 * Install any bundled default plugin that is missing from the profile, exactly
 * once per default. A per-profile marker records defaults that were already
 * handled so a user can uninstall a default without it returning on the next
 * launch. Install failures leave the marker untouched and are retried later.
 */
export async function ensureDefaultPlugins({
  dshHome,
  pnpmEntry,
  execPath,
  env,
  onOutput,
  signal,
  profile = PLUGIN_PROFILE,
  runGitImpl = runGit,
  runPnpmImpl = runPnpm,
  defaults = DEFAULT_PLUGINS,
}) {
  if (!Array.isArray(defaults)) throw new Error('Invalid default plugin list')
  const profileDir = ensureProfileInitialized(dshHome, profile)
  const seen = new Set(readDefaultPluginState(profileDir).seen)
  const installed = []
  for (const spec of defaults) {
    if (typeof spec !== 'string' || spec.trim() === '') continue
    const normalized = normalizePluginSpec(spec)
    const key = defaultPluginKey(normalized)
    if (defaultPluginAlreadySeen(seen, key)) {
      if (!seen.has(key)) {
        seen.add(key)
        writeDefaultPluginState(profileDir, { version: 1, seen: [...seen] })
      }
      continue
    }
    const catalog = readPluginCatalog({ dshHome, profile })
    const alreadyInstalled = catalog.plugins.some(plugin => plugin.installed && (
      normalized.source === 'github' ? pluginUsesGitHubSource(plugin, normalized) : plugin.name === normalized.packageName
    ))
    if (!alreadyInstalled) {
      await installPlugin({
        dshHome,
        pnpmEntry,
        spec,
        allowBuildScripts: false,
        execPath,
        env,
        onOutput,
        signal,
        profile,
        runGitImpl,
        runPnpmImpl,
      })
      installed.push(key)
    }
    seen.add(key)
    writeDefaultPluginState(profileDir, { version: 1, seen: [...seen] })
  }
  return { ...readPluginCatalog({ dshHome, profile }), installed }
}
