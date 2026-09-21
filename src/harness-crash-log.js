import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the Harness preload appends its last-exit record.
 *
 * The preload writes to `$DSH_DESKTOP_CRASH_LOG_DIR`, which defaults to
 * `<tmp>/dsh-desktop-harness`; pass the directory the child actually used.
 */
export function crashLogPath(base = tmpdir(), directory = 'dsh-desktop-harness') {
  return directory === '' ? join(base, 'last-exit.log') : join(base, directory, 'last-exit.log')
}

/**
 * Read the crash record the Harness preload writes when it is about to die.
 *
 * The child can exit with code 1 and no stderr at all — an uncaught exception
 * whose final output never reaches the parent pipe — so the only reliable trace
 * is the file the preload appends synchronously on the way out.
 *
 * Bounded and total: a missing, empty, or unreadable file reports as empty text.
 *
 * @param {{ path?: string, maxBytes?: number, offset?: number }} [options]
 * @returns {string} the newest record text, or '' when there is nothing to report
 */
export function readHarnessCrashRecord({ path = crashLogPath(), maxBytes = 16_384, offset = 0 } = {}) {
  let stats
  try {
    stats = statSync(path)
  } catch {
    return ''
  }
  // A record at or before `offset` belongs to an earlier Harness process.
  if (offset > 0 && stats.size <= offset) return ''

  const start = Math.max(offset, stats.size - maxBytes)
  let text = ''
  try {
    const handle = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(stats.size - start)
      readSync(handle, buffer, 0, buffer.length, start)
      text = buffer.toString('utf8')
    } finally {
      closeSync(handle)
    }
  } catch {
    return ''
  }
  return text.trim() === '' ? '' : text.trim()
}

/** Byte size of the crash record, for the next crash's offset. */
export function crashRecordSize(path = crashLogPath()) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/** Newest Node diagnostic report in a directory, or undefined when there is none. */
export function newestDiagnosticReport(directory, { sinceMs = 0 } = {}) {
  let entries = []
  try {
    entries = readdirSync(directory)
  } catch {
    return undefined
  }
  let newest
  for (const name of entries) {
    if (!name.startsWith('report.') || !name.endsWith('.json')) continue
    const path = join(directory, name)
    let stats
    try {
      stats = statSync(path)
    } catch {
      continue
    }
    // Reports are timestamped; `sinceMs` ignores the ones an earlier run left.
    if (stats.mtimeMs < sinceMs) continue
    if (newest === undefined || stats.mtimeMs > newest.mtimeMs) newest = { path, mtimeMs: stats.mtimeMs }
  }
  return newest?.path
}

/**
 * Read the fields of a Node diagnostic report that identify a native crash,
 * without dragging the whole (often multi-megabyte) document into the log.
 *
 * A report existing at all is the signal: `--report-on-fatalerror` writes one for
 * a native abort, so a crash with a report is native inside the process, while a
 * crash with no report was a kill from outside.
 *
 * @param {string} path report file
 * @returns {string} a `key: value` summary, or '' when nothing could be read
 */
export function readDiagnosticReportSummary(path) {
  let report
  try {
    report = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return ''
  }
  const lines = [`report: ${path}`]
  const push = (label, value) => {
    if (value !== undefined && value !== null && String(value) !== '') lines.push(`${label}: ${String(value)}`)
  }
  push('event', report.event)
  push('trigger', report.trigger)
  const header = report.header ?? {}
  push('commandLine', Array.isArray(header.commandLine) ? header.commandLine.join(' ') : undefined)
  push('node', header.nodejsVersion)
  push('platform', `${String(header.platform ?? '')}/${String(header.arch ?? '')}`)
  const jsStack = report.javascriptStack ?? {}
  push('fatalError', jsStack.errorMessage ?? jsStack.errorProperties?.message)
  push('fatalStack', jsStack.stack)
  const libuv = Array.isArray(report.libuv) ? report.libuv.filter((handle) => handle?.type !== undefined) : []
  if (libuv.length > 0) push('libuvHandles', libuv.map((handle) => handle.type).join(', '))
  return lines.length > 1 ? lines.join('\n') : ''
}
