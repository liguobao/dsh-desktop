'use strict'

const { appendFileSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

// The desktop parent owns this stdin pipe but never writes to it. If Electron
// crashes or is force-killed, the OS closes the pipe and this process receives
// the same SIGTERM path used by the normal application shutdown.
//
// This watcher must run ONLY in the main Harness process. node-pty's output
// worker (a worker thread) and its forked console-list agent inherit this
// preload through execArgv, and in a worker thread `process.stdin` is a stub
// that ends immediately — SIGTERM-ing the whole process on every terminal open.
//
// `DSH_DESKTOP_KEEPALIVE=1` additionally disables the watcher so a diagnostic
// harness with a closed stdin stays up for inspection.
const isHarnessEntry = (process.argv[1] ?? '').endsWith('bin.js')
if (isHarnessEntry && process.env.DSH_DESKTOP_KEEPALIVE !== '1' && process.stdin !== null) {
  process.stdin.resume()
  process.stdin.once('end', () => {
    process.kill(process.pid, 'SIGTERM')
  })
}

// The Harness has been observed exiting with code 1 and completely empty stderr.
// That is an uncaught exception whose final stderr chunk never reaches the parent
// pipe, so the Desktop log records the exit code and nothing else and the failure
// is undiagnosable. Persist the reason synchronously to a file the parent reads
// after the exit, and record who asks for a deliberate exit.
const LOG_DIRECTORY = process.env.DSH_DESKTOP_CRASH_LOG_DIR ?? join(tmpdir(), 'dsh-desktop-harness')
const LOG_PATH = join(LOG_DIRECTORY, 'last-exit.log')
const MAX_LINE = 4_000

try {
  mkdirSync(LOG_DIRECTORY, { recursive: true })
} catch {
  // Diagnostics must never stop the Harness from starting.
}

// A crash with an empty record has two very different readings: this preload
// never ran, or the process died without executing a single JavaScript exit
// path. This heartbeat separates them — if the log holds no start line for a
// run, the preload was not loaded at all.


function record(entry) {
  try {
    const stack = entry instanceof Error ? (entry.stack ?? `${entry.name}: ${entry.message}`) : String(entry)
    const body = stack.length > MAX_LINE ? `${stack.slice(0, MAX_LINE)}\n[truncated]` : stack
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${body}\n`)
  } catch {
    // A log write must never change process behaviour.
  }
}

process.on('uncaughtExceptionMonitor', (error, origin) => {
  record(`uncaughtException (${origin})\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
})

record(`preload active pid=${String(process.pid)} node=${process.version} argv1=${String(process.argv[1])}`)

process.on('unhandledRejection', (reason) => {
  record(`unhandledRejection\n${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
})

for (const [name, original] of [
  ['exit', process.exit],
  ['reallyExit', process.reallyExit],
]) {
  if (typeof original !== 'function') continue
  Object.defineProperty(process, name, {
    configurable: true,
    writable: true,
    value: function instrumentedExit(...args) {
      record(`process.${name}(${args.map(String).join(', ')})\n${new Error(`process.${name} requested`).stack ?? ''}`)
      return original.apply(this, args)
    },
  })
}

// Windows terminals run through node-pty. node-pty 1.2.0-beta removed winpty and
// its ConPTY-only path crashed the whole Harness with no JavaScript trace, so
// this build pins node-pty to 1.1.0 and forces the winpty backend here. 1.1.0
// still defaults `useConpty` to true when unset, so the option must be explicit.
// `DSH_DESKTOP_USE_CONPTY=1` opts back into ConPTY for comparison.
//
// Resolve node-pty from dsh-subprocess-local (its only consumer), not from this
// preload: the module is hoisted to the app root in the packaged layout but may
// sit nested under dsh-subprocess-local during development.
if (process.platform === 'win32' && isHarnessEntry) {
  try {
    const { createRequire } = require('node:module')
    const entryRequire = createRequire(process.argv[1])
    const subprocessPackage = entryRequire.resolve('@deepseek-ai/dsh-subprocess-local/package.json')
    const nodePty = createRequire(subprocessPackage)('node-pty')
    const useConpty = process.env.DSH_DESKTOP_USE_CONPTY === '1'
    const originalSpawn = nodePty.spawn
    const patchedSpawn = (file, args, options) => originalSpawn(file, args, { ...options, useConpty })
    patchedSpawn.__dshTerminalBackend = useConpty ? 'conpty' : 'winpty'
    nodePty.spawn = patchedSpawn
    record(`terminal backend pinned: ${useConpty ? 'conpty' : 'winpty'} (set DSH_DESKTOP_USE_CONPTY=1 for conpty)`)
  } catch (error) {
    record(`terminal backend pin failed: ${String(error)}`)
  }
}


