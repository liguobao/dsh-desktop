import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import process from 'node:process'
import semver from 'semver'
import { stringify } from 'yaml'
import { runPnpm } from './plugin-management.js'

export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'
export const DSH_RUNTIME_DIRECTORY = 'dsh-runtime'
export const DSH_ALLOWED_BUILD_PACKAGES = [
  '@deepseek-ai/dsh-subprocess-local',
  'koffi',
  'node-pty',
]
export const DSH_IGNORED_BUILD_PACKAGES = ['@google/genai', 'protobufjs']

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`
  writeFileSync(temporary, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function normalizedVersion(value) {
  if (typeof value !== 'string' || semver.valid(value) !== value) throw new Error('Invalid DSH version')
  return value
}

function packageManifestPath(directory) {
  return join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
}

function isWithin(root, target) {
  const path = relative(root, target)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export function inspectDshInstallation({ manifestPath, source }) {
  const manifest = readJson(manifestPath)
  if (manifest.name !== DSH_PACKAGE_NAME) throw new Error('Managed package is not @deepseek-ai/dsh')
  const version = normalizedVersion(manifest.version)
  const entry = join(dirname(manifestPath), 'lib', 'bin.js')
  if (!statSync(entry).isFile()) throw new Error('DSH entry point is missing')
  return { source, version, manifestPath, entry }
}

function managedVersionDirectory(runtimeRoot, version) {
  return join(runtimeRoot, 'versions', normalizedVersion(version))
}

function inspectManagedVersion(runtimeRoot, version) {
  const versionsRoot = join(runtimeRoot, 'versions')
  const directory = managedVersionDirectory(runtimeRoot, version)
  if (!lstatSync(directory).isDirectory()) throw new Error('Managed DSH version is not a directory')
  const realDirectory = realpathSync(directory)
  if (!isWithin(realpathSync(versionsRoot), realDirectory)) throw new Error('Managed DSH version escapes the runtime directory')
  const installation = inspectDshInstallation({ manifestPath: packageManifestPath(directory), source: 'managed' })
  if (installation.version !== version) throw new Error('Managed DSH version does not match its activation record')
  if (!isWithin(realDirectory, realpathSync(installation.entry))) throw new Error('Managed DSH entry escapes its version directory')
  return { ...installation, directory }
}

export function readActiveDshRuntime({ runtimeRoot, bundledManifestPath }) {
  const bundled = inspectDshInstallation({ manifestPath: bundledManifestPath, source: 'bundled' })
  const activePath = join(runtimeRoot, 'active.json')
  if (!existsSync(activePath)) return { ...bundled, bundled }
  try {
    const active = readJson(activePath)
    return { ...inspectManagedVersion(runtimeRoot, normalizedVersion(active.version)), bundled }
  } catch (error) {
    try {
      rmSync(activePath, { force: true })
    } catch {
      // A read-only corrupt activation record is ignored; the bundled runtime still starts.
    }
    return {
      ...bundled,
      bundled,
      managedError: error instanceof Error ? error.message : String(error),
    }
  }
}

export function parseDshRegistryVersion(output) {
  const candidates = [String(output).trim(), ...String(output).split(/\r?\n/).map(line => line.trim()).reverse()]
  for (const candidate of candidates) {
    if (candidate === '') continue
    try {
      const value = JSON.parse(candidate)
      const version = typeof value === 'string' ? value : value?.version
      if (typeof version === 'string' && semver.valid(version) === version) return version
    } catch {
      // pnpm may print a warning beside the JSON response; inspect individual lines next.
    }
  }
  throw new Error('The npm registry returned an invalid DSH version')
}

export async function checkForDshUpdate({
  currentVersion,
  runtimeRoot,
  pnpmEntry,
  execPath,
  env,
  signal,
  onOutput,
  runPnpmImpl = runPnpm,
}) {
  const current = normalizedVersion(currentVersion)
  mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 })
  const result = await runPnpmImpl({
    args: ['view', DSH_PACKAGE_NAME, 'version', '--json'],
    env,
    execPath,
    onOutput,
    pnpmEntry,
    profileDir: runtimeRoot,
    signal,
  })
  const latestVersion = parseDshRegistryVersion(result.output)
  return {
    currentVersion: current,
    latestVersion,
    available: semver.gt(latestVersion, current),
  }
}

export async function installDshVersion({
  version,
  runtimeRoot,
  pnpmEntry,
  execPath,
  env,
  signal,
  onOutput,
  runPnpmImpl = runPnpm,
}) {
  const normalized = normalizedVersion(version)
  const versionsRoot = join(runtimeRoot, 'versions')
  const target = managedVersionDirectory(runtimeRoot, normalized)
  mkdirSync(versionsRoot, { recursive: true, mode: 0o700 })

  try {
    const existing = inspectManagedVersion(runtimeRoot, normalized)
    writeJsonAtomic(join(runtimeRoot, 'active.json'), { version: normalized })
    return { ...existing, reused: true }
  } catch {
    // A partial prior install is app-owned and will be replaced after a fresh verified install.
  }

  const staging = join(runtimeRoot, `staging-${String(process.pid)}-${String(Date.now())}`)
  mkdirSync(staging, { recursive: false, mode: 0o700 })
  writeJsonAtomic(join(staging, 'package.json'), {
    name: 'dsh-desktop-managed-runtime',
    private: true,
    version: '0.0.0',
    dependencies: {},
  })
  writeFileSync(join(staging, 'pnpm-workspace.yaml'), stringify({
    packages: ['.'],
    allowBuilds: {
      ...Object.fromEntries(DSH_ALLOWED_BUILD_PACKAGES.map(packageName => [packageName, true])),
      ...Object.fromEntries(DSH_IGNORED_BUILD_PACKAGES.map(packageName => [packageName, false])),
    },
  }), { mode: 0o600 })

  try {
    await runPnpmImpl({
      args: [
        'add',
        '--save-prod',
        '--save-exact',
        '--reporter',
        'append-only',
        `${DSH_PACKAGE_NAME}@${normalized}`,
      ],
      env,
      execPath,
      onOutput,
      pnpmEntry,
      profileDir: staging,
      signal,
    })
    const installed = inspectDshInstallation({ manifestPath: packageManifestPath(staging), source: 'managed' })
    if (installed.version !== normalized) throw new Error(`Expected DSH ${normalized}, installed ${installed.version}`)
    if (existsSync(target)) rmSync(target, { recursive: true, force: true })
    renameSync(staging, target)
    const activated = inspectManagedVersion(runtimeRoot, normalized)
    writeJsonAtomic(join(runtimeRoot, 'active.json'), { version: normalized })
    return { ...activated, reused: false }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

export function deactivateManagedDsh(runtimeRoot) {
  rmSync(join(runtimeRoot, 'active.json'), { force: true })
}
