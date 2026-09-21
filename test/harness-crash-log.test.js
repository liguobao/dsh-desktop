import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { crashLogPath, crashRecordSize, newestDiagnosticReport, readDiagnosticReportSummary, readHarnessCrashRecord } from '../src/harness-crash-log.js'

function withLog(callback) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-crash-log-'))
  const path = join(root, 'last-exit.log')
  try {
    return callback({ root, path })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the crash log lives under the temporary directory', () => {
  assert.equal(crashLogPath('C:\\Temp'), join('C:\\Temp', 'dsh-desktop-harness', 'last-exit.log'))
})

test('a missing crash log reports nothing', () => {
  withLog(({ path }) => {
    assert.equal(readHarnessCrashRecord({ path }), '')
    assert.equal(crashRecordSize(path), 0)
  })
})

test('the newest crash record is returned', () => {
  withLog(({ path }) => {
    writeFileSync(path, '[t1] uncaughtException (uncaughtException)\nError: boom\n    at a\n')
    assert.match(readHarnessCrashRecord({ path }), /Error: boom/)

    appendFileSync(path, '[t2] process.exit(1)\nError: process.exit requested\n    at b\n')
    assert.match(readHarnessCrashRecord({ path }), /process\.exit requested/)
  })
})

test('a record written after the previous process is the only one reported', () => {
  withLog(({ path }) => {
    writeFileSync(path, '[t1] uncaughtException\nError: first-run\n')
    const offset = crashRecordSize(path)

    // Same size, same process: nothing new to report.
    assert.equal(readHarnessCrashRecord({ path, offset }), '')

    appendFileSync(path, '[t2] uncaughtException\nError: second-run\n')
    const record = readHarnessCrashRecord({ path, offset })
    assert.match(record, /second-run/)
    assert.doesNotMatch(record, /first-run/)
  })
})

test('the record read is bounded', () => {
  withLog(({ path }) => {
    writeFileSync(path, `[t] uncaughtException\n${'x'.repeat(5000)}\n`)
    assert.ok(readHarnessCrashRecord({ path, maxBytes: 512 }).length <= 512)
  })
})

test('an empty crash log reports nothing', () => {
  withLog(({ path }) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '   \n')
    assert.equal(readHarnessCrashRecord({ path }), '')
  })
})

test('the newest fatal report is selected and old runs are ignored', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-report-'))
  try {
    assert.equal(newestDiagnosticReport(root), undefined)
    assert.equal(newestDiagnosticReport(join(root, 'missing')), undefined)

    const first = join(root, 'report.20260101.000000.001.0.001.json')
    writeFileSync(first, '{}')
    assert.match(newestDiagnosticReport(root), /report\.20260101/)

    // Report names carry a timestamp but the selector compares mtimes, so make
    // the ordering explicit instead of relying on sub-millisecond write latency.
    const second = join(root, 'report.20260102.000000.002.0.002.json')
    writeFileSync(second, '{}')
    utimesSync(first, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    assert.match(newestDiagnosticReport(root), /report\.20260102/)

    // Reports older than the current run must not be reported as this crash.
    assert.equal(newestDiagnosticReport(root, { sinceMs: Date.now() + 60_000 }), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a fatal report is summarised without its bulk', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-report-'))
  try {
    const path = join(root, 'report.20260101.000000.001.0.001.json')
    writeFileSync(path, JSON.stringify({
      event: 'FatalError',
      trigger: 'FatalError',
      header: { commandLine: ['electron.exe', 'bin.js', 'web'], nodejsVersion: '24.18.1', platform: 'win32', arch: 'x64' },
      javascriptStack: { errorMessage: 'native abort', stack: 'at native' },
      libuv: [{ type: 'tty' }, { type: 'pipe' }],
      bulk: 'x'.repeat(200_000),
    }))

    const summary = readDiagnosticReportSummary(path)
    assert.match(summary, /event: FatalError/)
    assert.match(summary, /node: 24\.18\.1/)
    assert.match(summary, /libuvHandles: tty, pipe/)
    assert.ok(summary.length < 1_000, 'the summary must not carry the report bulk')

    assert.equal(readDiagnosticReportSummary(join(root, 'missing.json')), '')
    writeFileSync(join(root, 'broken.json'), 'not json')
    assert.equal(readDiagnosticReportSummary(join(root, 'broken.json')), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
