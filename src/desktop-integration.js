import { spawn as nodeSpawn } from 'node:child_process'
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

export const DESKTOP_PLUGIN_PACKAGE = '@dsh-desktop/integration'
export const DESKTOP_PLUGIN_FILES = ['package.json', 'lib/index.js', 'lib/client.js']
export const MAX_DESKTOP_PATH_LENGTH = 32_768

function quoteShellArgument(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Put app-owned Node and pnpm launchers first on Harness' PATH. Finder-launched
 * macOS apps do not inherit a login-shell PATH, and a user pnpm launcher may
 * otherwise fail while looking for an external `node` binary.
 */
export function prepareHarnessToolchain({ directory, execPath, pnpmEntry, env = process.env, platform = process.platform }) {
  mkdirSync(directory, { recursive: true })
  if (platform === 'win32') {
    writeFileSync(join(directory, 'node.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" %*\r\n`)
    writeFileSync(join(directory, 'pnpm.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" "${pnpmEntry}" %*\r\n`)
  } else {
    const executable = quoteShellArgument(execPath)
    writeFileSync(join(directory, 'node'), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${executable} "$@"\n`)
    writeFileSync(join(directory, 'pnpm'), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${executable} ${quoteShellArgument(pnpmEntry)} "$@"\n`)
    chmodSync(join(directory, 'node'), 0o755)
    chmodSync(join(directory, 'pnpm'), 0o755)
  }
  return { ...env, PATH: `${directory}${delimiter}${env.PATH ?? ''}` }
}

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cfg', '.clj', '.cljs', '.cmake', '.conf', '.cpp', '.cs', '.css',
  '.csv', '.dart', '.diff', '.env', '.ex', '.exs', '.fish', '.fs', '.fsx', '.go',
  '.graphql', '.groovy', '.h', '.hpp', '.ini', '.java', '.js', '.json', '.json5',
  '.jsx', '.kt', '.kts', '.less', '.lua', '.md', '.mdx', '.mjs', '.mm', '.php',
  '.pl', '.properties', '.ps1', '.py', '.rb', '.rs', '.sass', '.scss', '.sh',
  '.sql', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml',
  '.yaml', '.yml', '.zig', '.zsh',
])

const TEXT_BASENAMES = new Set([
  'dockerfile', 'gemfile', 'justfile', 'license', 'makefile', 'notice', 'procfile',
  'readme',
])

function expandHome(path, userHome) {
  if (path === '~') return userHome
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(userHome, path.slice(2))
  return path
}

/** Resolve the same DSH home used by the child process without importing Harness internals. */
export function resolveHarnessHome(env = process.env, cwd = process.cwd(), userHome = homedir()) {
  const configured = env.DSH_HOME?.trim()
  const value = configured ? expandHome(configured, userHome) : join(userHome, '.dsh')
  return resolve(cwd, value)
}

/** Install the app-owned out-of-tree plugin into DSH's documented profile fallback. */
export function installDesktopPlugin({ sourceDir, dshHome }) {
  const manifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'))
  if (manifest.name !== DESKTOP_PLUGIN_PACKAGE) {
    throw new Error(`Desktop integration package must be named ${DESKTOP_PLUGIN_PACKAGE}`)
  }

  const targetDir = join(dshHome, 'profiles', 'node_modules', '@dsh-desktop', 'integration')
  for (const file of DESKTOP_PLUGIN_FILES) {
    const source = join(sourceDir, file)
    const target = join(targetDir, file)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
  return targetDir
}

function validatePathString(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_DESKTOP_PATH_LENGTH) {
    throw new Error('Path is missing or too long')
  }
  if (path.includes('\0')) throw new Error('Path contains a NUL character')
  if (!isAbsolute(path)) throw new Error('Only absolute paths can be opened')
}

function canonicalDirectory(path) {
  validatePathString(path)
  const canonical = realpathSync(path)
  if (!statSync(canonical).isDirectory()) throw new Error('Workspace root is not a directory')
  return canonical
}

/** Accept only existing absolute workspace roots and keep active as one of them. */
export function normalizeWorkspaceContext(value) {
  const candidates = Array.isArray(value?.roots) ? value.roots.slice(0, 256) : []
  if (typeof value?.active === 'string') candidates.push(value.active)

  const roots = []
  for (const candidate of candidates) {
    try {
      const canonical = canonicalDirectory(candidate)
      if (!roots.includes(canonical)) roots.push(canonical)
    } catch {
      // Workspace state can briefly name a directory that was moved or removed.
    }
  }

  let active
  if (typeof value?.active === 'string') {
    try {
      active = canonicalDirectory(value.active)
    } catch {
      active = undefined
    }
  }
  return { active, roots }
}

function comparablePath(path, platform) {
  return platform === 'win32' ? path.toLowerCase() : path
}

/** Return the canonical target only when it stays inside a known workspace root. */
export function authorizeWorkspacePath(path, roots, platform = process.platform) {
  validatePathString(path)
  const target = realpathSync(path)
  statSync(target)
  const comparableTarget = comparablePath(target, platform)
  const allowed = roots.some((root) => {
    const candidate = relative(comparablePath(root, platform), comparableTarget)
    return candidate === '' || (candidate !== '..' && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate))
  })
  if (!allowed) throw new Error('Path is outside the active Harness workspaces')
  return target
}

function executable(path) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function findOnPath(names, env) {
  const directories = (env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const directory of directories) {
    for (const name of names) {
      const candidate = join(directory, name)
      if (executable(candidate)) return candidate
    }
  }
  return undefined
}

function editorDefinitions(platform, env) {
  const localAppData = env.LOCALAPPDATA ?? ''
  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES ?? ''
  const programFilesX86 = env['ProgramFiles(x86)'] ?? env.PROGRAMFILES_X86 ?? ''
  const under = (base, ...parts) => base === '' ? undefined : join(base, ...parts)
  return [
    {
      id: 'vscode',
      label: 'Visual Studio Code',
      pathNames: platform === 'win32' ? ['code.exe'] : ['code'],
      fixed: platform === 'darwin'
        ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
        : platform === 'win32'
          ? [
              under(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
              under(programFiles, 'Microsoft VS Code', 'Code.exe'),
              under(programFilesX86, 'Microsoft VS Code', 'Code.exe'),
            ].filter(Boolean)
          : ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code'],
    },
    {
      id: 'cursor',
      label: 'Cursor',
      pathNames: platform === 'win32' ? ['cursor.exe'] : ['cursor'],
      fixed: platform === 'darwin'
        ? ['/Applications/Cursor.app/Contents/Resources/app/bin/cursor']
        : platform === 'win32'
          ? [under(localAppData, 'Programs', 'cursor', 'Cursor.exe')].filter(Boolean)
          : ['/usr/bin/cursor', '/usr/local/bin/cursor'],
    },
    {
      id: 'vscodium',
      label: 'VSCodium',
      pathNames: platform === 'win32' ? ['codium.exe'] : ['codium'],
      fixed: platform === 'darwin'
        ? ['/Applications/VSCodium.app/Contents/Resources/app/bin/codium']
        : platform === 'win32'
          ? [under(localAppData, 'Programs', 'VSCodium', 'VSCodium.exe')].filter(Boolean)
          : ['/usr/bin/codium', '/usr/local/bin/codium', '/snap/bin/codium'],
    },
    {
      id: 'zed',
      label: 'Zed',
      pathNames: platform === 'win32' ? ['zed.exe'] : ['zed'],
      fixed: platform === 'darwin'
        ? ['/Applications/Zed.app/Contents/MacOS/cli']
        : platform === 'win32'
          ? [under(localAppData, 'Programs', 'Zed', 'Zed.exe')].filter(Boolean)
          : ['/usr/bin/zed', '/usr/local/bin/zed'],
    },
  ]
}

/** Detect supported graphical editors without invoking a shell. */
export function detectEditors({ platform = process.platform, env = process.env } = {}) {
  return editorDefinitions(platform, env).flatMap((definition) => {
    const command = findOnPath(definition.pathNames, env) ?? definition.fixed.find(executable)
    return command === undefined ? [] : [{ id: definition.id, label: definition.label, command }]
  })
}

export function selectedEditor(editors, preference = 'auto') {
  return editors.find(editor => editor.id === preference) ?? editors[0]
}

export function normalizeEditorPreference(preference, editors) {
  return preference === 'auto' || editors.some(editor => editor.id === preference) ? preference : 'auto'
}

export function isTextLikePath(path) {
  const extension = extname(path).toLowerCase()
  if (TEXT_EXTENSIONS.has(extension)) return true
  const name = basename(path).toLowerCase()
  return TEXT_BASENAMES.has(name) || (extension === '' && name.startsWith('.') && name.length > 1)
}

/** Launch an editor with an argv array; no path is ever interpreted by a shell. */
export function launchEditor(editor, path, spawnImpl = nodeSpawn) {
  return new Promise((resolveLaunch, reject) => {
    const child = spawnImpl(editor.command, [path], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolveLaunch()
    })
  })
}

export function readDesktopSettings(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return { editor: typeof parsed.editor === 'string' ? parsed.editor : 'auto' }
  } catch {
    return { editor: 'auto' }
  }
}

export function writeDesktopSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${String(process.pid)}`
  writeFileSync(temporary, `${JSON.stringify(settings, undefined, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}
