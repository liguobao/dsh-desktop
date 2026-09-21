/**
 * Patch node-pty's Windows helpers so a terminal can neither take the whole
 * Harness down nor inherit the launcher's Node flags.
 *
 * Why this patch exists
 * ---------------------
 * Two independent defects in node-pty's Windows path, both fixed here by
 * exact-byte replacement so an upstream rewrite fails loudly.
 *
 * 1. execArgv leakage — the crash behind "open the terminal and the Harness dies"
 *
 *    node-pty starts two helpers of its own without an `execArgv` option:
 *
 *        new worker_threads_1.Worker(..., { workerData: workerData })   // windowsConoutConnection.js
 *        child_process_1.fork('conpty_console_list_agent', [...])        // windowsPtyAgent.js
 *
 *    Node defaults a worker's and a forked child's `execArgv` to
 *    `process.execArgv`, so every `--require` / `--loader` / `--inspect` flag a
 *    launcher put on the Harness is replayed inside those helpers. DSH Desktop
 *    launches the Harness with `--require parent-watch.cjs`, whose stdin watcher
 *    kills the process when stdin ends. Inside the ConPTY output worker
 *    `process.stdin` is an already-ended stub, so the watcher fires
 *    `process.kill(process.pid, 'SIGTERM')` on the newly created thread and the
 *    whole Harness exits with code 1 the instant a terminal is opened — silently,
 *    because a signal death runs no JavaScript exit path.
 *
 *    Neither helper needs a single host flag: the worker only pumps a named pipe
 *    and the agent only reads a console process list. `execArgv: []` is the fix.
 *    It is written to match both shipped layouts (1.1.0 uses `path_1.join(...)`,
 *    1.2.0-beta.x uses `(0, path_1.join)(...)`), so the same edit covers either.
 *
 * 2. ConPTY teardown guard — a second, independent fatal path
 *
 *    In the ConPTY-only builds, `WindowsPtyAgent` registers its output-worker
 *    error handler before the constructor creates the input socket:
 *
 *        this._conoutSocketWorker.onError((error) => this._failPtyConnection(error));  // constructor
 *        this._inSocket = new net.Socket({ fd: inSocketFD, ... })                     // a few lines later
 *
 *    `_failPtyConnection` then destroys both sockets unconditionally. When the
 *    worker fails before they exist (a blocked ConPTY pipe, a worker thread that
 *    cannot start, an interpreter being torn down), that is
 *    `TypeError: Cannot read properties of undefined (reading 'destroy')` thrown
 *    from a worker message handler dispatched inside `process.nextTick` — an
 *    uncaught exception that kills the Harness with exit code 1. The two
 *    replacements below turn it into the intended failure: the caller sees an
 *    error on the PTY error channel and the terminal shows its own error state,
 *    while the rest of the Harness keeps running.
 *
 * Contract
 * --------
 * - Windows only. macOS and Linux do not reach this Windows agent at all, so the
 *   patch is a no-op elsewhere.
 * - Exact-byte replacement, never a regex, so a changed upstream file fails
 *   loudly instead of being silently half-patched.
 * - Idempotent: a second run reports the patch as already applied.
 * - The ConPTY teardown guards apply only to the ConPTY-only builds; a
 *   winpty-capable node-pty never reaches that path. The execArgv edits apply to
 *   every build, because both shipped layouts have the leak.
 * - Runs from `postinstall`; `npm ci --ignore-scripts` skips it, which
 *   `test/node-pty-patch.test.js` catches on the packaged tree.
 *
 * Usage:
 *   node scripts/patch-node-pty-windows.mjs [--check] [--root <dir>]
 *
 *   --check  report status only; exit 1 when any target is unpatched
 *   --root   directory whose node_modules is patched (defaults to this repo)
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Marks a line this script rewrote. Two markers keep the two reasons readable. */
export const EXEC_ARGV_MARKER = 'PATCH(dsh-desktop-node-pty-execArgv)'
export const GUARD_MARKER = 'PATCH(dsh-desktop-node-pty-guard)'

export const CONOUT_FILE = 'node_modules/node-pty/lib/windowsConoutConnection.js'
export const AGENT_FILE = 'node_modules/node-pty/lib/windowsPtyAgent.js'

/**
 * Every file this script touches, with the exact-byte edits it needs.
 *
 * Each patch is anchored on the smallest text that is stable across the node-pty
 * releases that ship it, and is exported so `test/node-pty-patch.test.js` can
 * assert each literal against the real upstream file instead of a hand-written
 * approximation.
 *
 * `conptyOnly` marks an edit that must not be applied to a winpty-capable build:
 * that build defaults to winpty and never reaches the ConPTY teardown.
 */
export const TARGETS = [
  {
    file: CONOUT_FILE,
    patches: [
      {
        id: 'ConoutConnection output worker must not inherit execArgv',
        // `{ workerData: workerData }` is the whole options object and is unique
        // in the file, so the edit is independent of the surrounding call shape.
        original: '{ workerData: workerData }',
        patched: `{ workerData: workerData, execArgv: [] /* ${EXEC_ARGV_MARKER} */ }`,
      },
    ],
  },
  {
    file: AGENT_FILE,
    patches: [
      {
        id: 'conpty_console_list_agent fork must not inherit execArgv',
        // Both layouts end the forked argv with `[_this._innerPid.toString()]);`.
        original: '[_this._innerPid.toString()]);',
        patched: `[_this._innerPid.toString()], { execArgv: [] /* ${EXEC_ARGV_MARKER} */ });`,
      },
      {
        conptyOnly: true,
        id: 'WindowsPtyAgent._failPtyConnection (worker error path)',
        original: [
          '        this._conoutSocketWorker.dispose();',
          '        this._inSocket.destroy();',
          '        this._outSocket.destroy();',
          '        this._onError.fire(error);',
        ].join('\n'),
        patched: [
          '        this._conoutSocketWorker.dispose();',
          `        // ${GUARD_MARKER}: the ConPTY output-worker error`,
          '        // handler fires before the constructor creates _inSocket, so these',
          '        // destroys must not assume the socket exists. Without this guard the',
          '        // failure is an uncaught TypeError that kills the whole process.',
          '        if (this._inSocket) {',
          '            this._inSocket.destroy();',
          '        }',
          '        if (this._outSocket) {',
          '            this._outSocket.destroy();',
          '        }',
          '        this._onError.fire(error);',
        ].join('\n'),
      },
      {
        conptyOnly: true,
        id: 'WindowsPtyAgent._completePtyConnection (conpty connect failure path)',
        original: [
          '            this._conoutSocketWorker.dispose();',
          '            this._inSocket.destroy();',
          '            this._outSocket.destroy();',
          '            this._onError.fire(err);',
        ].join('\n'),
        patched: [
          '            this._conoutSocketWorker.dispose();',
          `            // ${GUARD_MARKER}`,
          '            if (this._inSocket) {',
          '                this._inSocket.destroy();',
          '            }',
          '            if (this._outSocket) {',
          '                this._outSocket.destroy();',
          '            }',
          '            this._onError.fire(err);',
        ].join('\n'),
      },
    ],
  },
]

/**
 * The ConPTY teardown guard is meaningless on a release that still ships the
 * winpty backend: those builds default `useConpty` to false when the caller
 * leaves it unset, so the guarded destructors are never reached.
 */
function isWinptyCapable(source) {
  return /winptyNative/.test(source) || source.includes('winpty-agent.exe')
}

function countOccurrences(haystack, needle) {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

export function targetFor(file) {
  return TARGETS.find((entry) => entry.file === file)
}

/**
 * Apply every patch for one node-pty file, or explain why it cannot.
 *
 * Statuses: `patched`, `already-patched`, `winpty-default` (every patch for this
 * file is ConPTY-only and the build ships winpty), or `unexpected-upstream`.
 */
export function patchSource(file, source) {
  const target = targetFor(file)
  if (target === undefined) throw new Error(`no patch target registered for ${file}`)

  let next = source
  let applied = 0
  let skipped = 0

  for (const patch of target.patches) {
    // Idempotency is per patch: a file may legitimately carry only the execArgv
    // edits while the ConPTY guards are skipped for a winpty-capable build.
    if (next.includes(patch.patched)) continue

    if (patch.conptyOnly === true && isWinptyCapable(source)) {
      skipped += 1
      continue
    }

    const occurrences = countOccurrences(next, patch.original)
    if (occurrences !== 1) {
      return { status: 'unexpected-upstream', file, replacement: patch.id, occurrences }
    }
    next = next.replace(patch.original, patch.patched)
    applied += 1
  }

  if (applied > 0) return { status: 'patched', file, source: next, applied }
  if (skipped === target.patches.length) return { status: 'winpty-default', file, source }
  return { status: 'already-patched', file, source }
}

/**
 * Every node-pty lib directory a package manager may have produced: hoisted to
 * the app root, or nested under the Harness package that depends on it. npm
 * hoists when it can, but an override or a second version keeps it nested.
 */
export function discoverTargets(root) {
  const libs = [join(root, 'node_modules', 'node-pty', 'lib')]
  const scope = join(root, 'node_modules', '@deepseek-ai')
  try {
    for (const entry of readdirSync(scope, { withFileTypes: true })) {
      if (entry.isDirectory()) libs.push(join(scope, entry.name, 'node_modules', 'node-pty', 'lib'))
    }
  } catch {
    // No scoped Harness packages: only the hoisted location can exist.
  }

  const targets = []
  for (const lib of libs) {
    if (!existsSync(lib)) continue
    for (const entry of TARGETS) {
      targets.push({ file: entry.file, path: join(lib, entry.file.slice(entry.file.lastIndexOf('/') + 1)) })
    }
  }
  return targets
}

function parseArgs(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  let check = false
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--check') check = true
    else if (arg === '--root') {
      index += 1
      if (argv[index] === undefined) throw new Error('--root requires a directory')
      root = resolve(argv[index])
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  return { root, check }
}

export function run({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), check = false, platform = process.platform, log = console.log } = {}) {
  if (platform !== 'win32') {
    log(`node-pty patch: skipped on ${platform} (Windows-only paths)`)
    return 0
  }

  const targets = discoverTargets(root)
  if (targets.length === 0) {
    log(`node-pty patch: FAILED: no node-pty lib directory under ${root}`)
    return 1
  }

  let failures = 0
  for (const target of targets) {
    if (!existsSync(target.path)) {
      log(`node-pty patch: FAILED: ${target.path} is missing; node-pty changed its lib layout`)
      failures += 1
      continue
    }

    const source = readFileSync(target.path, 'utf8')
    const result = patchSource(target.file, source)

    if (result.status === 'already-patched') {
      log(`node-pty patch: already patched: ${target.path}`)
      continue
    }

    if (result.status === 'winpty-default') {
      log(`node-pty patch: winpty-capable node-pty, ConPTY guard not needed: ${target.path}`)
      continue
    }

    if (result.status === 'unexpected-upstream') {
      log(
        `node-pty patch: FAILED: ${target.path} does not match the expected upstream text for\n` +
          `  ${result.replacement}\n` +
          `  (found ${String(result.occurrences)} occurrence(s), expected exactly 1).\n` +
          '  node-pty changed its Windows agent: re-check whether the new version still needs the patch.\n' +
          '  If it does, update scripts/patch-node-pty-windows.mjs; if the upstream fix is present, delete this script and the postinstall hook.',
      )
      failures += 1
      continue
    }

    if (check) {
      log(`node-pty patch: UNPATCHED ${target.path}`)
      failures += 1
      continue
    }

    try {
      writeFileSync(target.path, result.source)
    } catch (error) {
      log(`node-pty patch: FAILED: cannot write ${target.path}: ${error.message}`)
      failures += 1
      continue
    }
    log(`node-pty patch: patched ${target.path} (${String(result.applied)} edit(s))`)
  }

  return failures === 0 ? 0 : 1
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  try {
    const { root, check } = parseArgs(process.argv.slice(2))
    process.exitCode = run({ root, check })
  } catch (error) {
    console.error(`node-pty patch: ${error.message}`)
    process.exitCode = 1
  }
}
