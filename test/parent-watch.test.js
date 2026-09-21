import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Worker } from 'node:worker_threads'

import { crashLogPath, readHarnessCrashRecord } from '../src/harness-crash-log.js'

const preload = join(import.meta.dirname, '..', 'src', 'parent-watch.cjs')
const source = readFileSync(preload, 'utf8')

test('parent watch closes the Harness when the desktop parent goes away', () => {
  assert.match(source, /process\.stdin\.once\('end'/)
  assert.match(source, /process\.kill\(process\.pid, 'SIGTERM'\)/)
})

test('parent watch records the reason a Harness dies without stderr', () => {
  // A code-1 exit with empty stderr is an uncaught exception whose last chunk
  // never reaches the parent pipe, so the record must be written to a file.
  assert.match(source, /uncaughtExceptionMonitor/)
  assert.match(source, /appendFileSync/)
  assert.match(source, /process\.reallyExit/)
  // A start line separates "the preload never ran" from "the process died
  // without running any exit path" — identical from an empty record otherwise.
  assert.match(source, /preload active/)
})

test('Windows pins node-pty to the winpty backend by default', () => {
  // node-pty 1.1.0 defaults `useConpty` to true when unset, so the backend must
  // be forced explicitly; ConPTY is opt-in for comparison.
  assert.match(source, /useConpty: false|useConpty =|DSH_DESKTOP_USE_CONPTY/)
  assert.match(source, /useConpty/)
  assert.match(source, /dsh-subprocess-local/)
})

test('the stdin watcher only runs in the main Harness entry', () => {
  // node-pty's worker thread inherits --require and its stdin stub ends at once;
  // installing the parent watcher there SIGTERMs the whole process on terminal
  // open. The watcher must be gated to the bin.js entry point.
  assert.match(source, /isHarnessEntry/)
  assert.match(source, /endsWith\('bin\.js'\)/)
})

test('a worker thread that inherits the preload does not kill the process', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-parent-watch-worker-'))
  try {
    const worker = new Worker('require("node:fs").writeFileSync(process.env.PROBE_LOG, "ran")', {
      eval: true,
      execArgv: ['--require', preload],
      env: { ...process.env, DSH_DESKTOP_CRASH_LOG_DIR: root, PROBE_LOG: join(root, 'worker.txt') },
    })
    const code = await new Promise((resolve) => worker.on('exit', resolve))
    assert.equal(code, 0)
    assert.equal(readFileSync(join(root, 'worker.txt'), 'utf8'), 'ran')
    // The process is still here to assert this, which is the actual regression.
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an uncaught exception leaves a record the parent can read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-parent-watch-'))
  try {
    const script = join(root, 'crash.mjs')
    writeFileSync(script, "setTimeout(() => { throw new Error('probe-crash') }, 20)\n")

    // stdin must stay open: the preload intentionally kills the Harness when the
    // desktop parent's pipe closes, and a synchronous spawn would hand the child
    // a closed one. `os.tmpdir()` caches its answer, so redirect through the
    // preload's own seam instead of the child's TMP variables.
    const child = spawn(process.execPath, ['--require', preload, script], {
      env: { ...process.env, DSH_DESKTOP_CRASH_LOG_DIR: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.resume()

    const status = await new Promise((resolve) => child.on('exit', (code) => resolve(code)))
    child.stdin.end()

    assert.equal(status, 1)
    // The child wrote straight into the directory the seam pointed at.
    const record = readHarnessCrashRecord({ path: crashLogPath(root, '') })
    assert.match(record, /uncaughtException/)
    assert.match(record, /probe-crash/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
