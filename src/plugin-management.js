import { spawn as nodeSpawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

export const PLUGIN_PROFILE = 'web'
export const MAX_PLUGIN_SPEC_LENGTH = 214
export const MAX_PLUGIN_OUTPUT_LENGTH = 64 * 1024
export const SYSTEM_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const PACKAGE_SELECTOR_PATTERN = /^[a-z0-9~^*<>=|+_.-]+$/i

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`
  writeFileSync(temporary, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
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

function pluginMetadata(profileDir, packageName, requested, enabled) {
  const manifest = readInstalledManifest(profileDir, packageName)
  const bundle = manifest?.dsh?.bundle?.patch !== undefined
  return {
    name: packageName,
    requested,
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

  const slash = spec.startsWith('@') ? spec.indexOf('/') : -1
  const selectorAt = spec.indexOf('@', slash + 1)
  const packageName = selectorAt === -1 ? spec : spec.slice(0, selectorAt)
  const selector = selectorAt === -1 ? undefined : spec.slice(selectorAt + 1)
  if (!PACKAGE_NAME_PATTERN.test(packageName) || (selector !== undefined && !PACKAGE_SELECTOR_PATTERN.test(selector))) {
    throw new Error('Use an npm package name with an optional version')
  }
  if (SYSTEM_BUNDLES.has(packageName)) throw new Error('System bundles are managed by DSH Desktop')
  return { spec, packageName }
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

export async function installPlugin({ dshHome, pnpmEntry, spec, execPath, env, onOutput, signal, profile = PLUGIN_PROFILE }) {
  const normalized = normalizePluginSpec(spec)
  const profileDir = profileDirectory(dshHome, profile)
  await runPnpm({
    args: ['add', '--save-prod', '--reporter', 'append-only', normalized.spec],
    env,
    execPath,
    onOutput,
    pnpmEntry,
    profileDir,
    signal,
  })
  const catalog = readPluginCatalog({ dshHome, profile })
  const plugin = catalog.plugins.find(candidate => candidate.name === normalized.packageName)
  if (plugin?.bundle) setPluginEnabled({ dshHome, name: plugin.name, enabled: true, profile })
  return readPluginCatalog({ dshHome, profile })
}

export async function removePlugin({ dshHome, pnpmEntry, name, execPath, env, onOutput, signal, profile = PLUGIN_PROFILE }) {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('Invalid plugin package name')
  if (SYSTEM_BUNDLES.has(name)) throw new Error('System bundles cannot be removed')
  const catalog = readPluginCatalog({ dshHome, profile })
  if (!catalog.plugins.some(plugin => plugin.name === name)) throw new Error('Plugin is not installed')
  await runPnpm({
    args: ['remove', '--reporter', 'append-only', name],
    env,
    execPath,
    onOutput,
    pnpmEntry,
    profileDir: catalog.profileDir,
    signal,
  })
  forgetPluginBundle({ dshHome, name, profile })
  return readPluginCatalog({ dshHome, profile })
}
