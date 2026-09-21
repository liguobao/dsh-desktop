import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  AGENT_FILE,
  CONOUT_FILE,
  EXEC_ARGV_MARKER,
  GUARD_MARKER,
  TARGETS,
  patchSource,
  run,
} from '../scripts/patch-node-pty-windows.mjs'

const require = createRequire(import.meta.url)
/** Must match the installer's layout: node-pty always sits under node_modules. */
const LIB = 'node_modules/node-pty/lib'

function patchesFor(file) {
  const target = TARGETS.find((entry) => entry.file === file)
  assert.ok(target, `no patch target registered for ${file}`)
  return target.patches
}

const execArgvPatch = (file) => {
  const patch = patchesFor(file).find((entry) => entry.patched.includes(EXEC_ARGV_MARKER))
  assert.ok(patch, `${file} has no execArgv patch`)
  return patch
}

const guardPatches = () => patchesFor(AGENT_FILE).filter((entry) => entry.patched.includes(GUARD_MARKER))

const localName = (file) => file.slice(file.lastIndexOf('/') + 1)

/**
 * Stand-ins for the upstream files, assembled from the patcher's own literals so
 * they cannot drift by a newline and silently turn these tests into noise.
 *
 * Both shipped call shapes are covered: node-pty 1.1.0 wraps its requires as
 * `path_1.join(...)` / `child_process_1.fork(...)`, and 1.2.0-beta.x emits the
 * `(0, path_1.join)(...)` / `(0, child_process_1.fork)(...)` helper form.
 */
function conoutSource({ modern = false } = {}) {
  const { original } = execArgvPatch(CONOUT_FILE)
  const join = modern ? "(0, path_1.join)(scriptPath, 'worker/conoutSocketWorker.js')" : "path_1.join(scriptPath, 'worker/conoutSocketWorker.js')"
  return [
    'var worker_threads_1 = require("worker_threads");',
    'var ConoutConnection = (function () {',
    '    function ConoutConnection(_conoutPipeName) {',
    '        var workerData = {',
    '            conoutPipeName: _conoutPipeName',
    '        };',
    `        this._worker = new worker_threads_1.Worker(${join}, ${original});`,
    '    }',
    '    return ConoutConnection;',
    '}());',
    '',
  ].join('\n')
}

function agentSource({ modern = false, conptyOnly = true } = {}) {
  const fork = execArgvPatch(AGENT_FILE)
  const call = modern
    ? "(0, child_process_1.fork)(path.join(__dirname, 'conpty_console_list_agent'), [_this._innerPid.toString()]);"
    : "child_process_1.fork(path.join(__dirname, 'conpty_console_list_agent'), [_this._innerPid.toString()]);"
  // The fork anchor is the tail of the line, so both shapes must carry it.
  assert.ok(call.endsWith(fork.original), 'fixture fork line must end with the patcher anchor')

  const [fail, complete] = guardPatches()
  const lines = [
    'var child_process_1 = require("child_process");',
    'var path = require("path");',
    'var WindowsPtyAgent = (function () {',
    '    function WindowsPtyAgent() {',
    '        this._outSocket = new net_1.Socket();',
    '    }',
    '    WindowsPtyAgent.prototype._getConsoleProcessList = function () {',
    `            var agent = ${call}`,
    '    };',
  ]

  if (conptyOnly) {
    lines.push('    WindowsPtyAgent.prototype._completePtyConnection = function () {')
    lines.push('        try {')
    lines.push('            var connect = conptyNative.connect(pty, commandLine, cwd, env, this._useConptyDll, callback);')
    lines.push('            this._innerPid = connect.pid;')
    lines.push('        }')
    lines.push('        catch (err) {')
    lines.push(...complete.original.split('\n'))
    lines.push('        }')
    lines.push('    };')
    lines.push('    WindowsPtyAgent.prototype._failPtyConnection = function (error) {')
    lines.push(...fail.original.split('\n'))
    lines.push('    };')
  } else {
    // A release that still ships winpty: no ConPTY-only teardown exists here.
    lines.push('var winptyNative;')
    lines.push("winptyNative = require('./utils').loadNativeModule('pty').module;")
  }

  lines.push('    return WindowsPtyAgent;')
  lines.push('}());')
  lines.push('')
  return lines.join('\n')
}

/** Write one node-pty lib directory, or a partial one when a file is `null`. */
function writeTree(root, { conout = conoutSource(), agent = agentSource() } = {}) {
  const lib = join(root, LIB)
  mkdirSync(lib, { recursive: true })
  if (conout !== null) writeFileSync(join(lib, localName(CONOUT_FILE)), conout)
  if (agent !== null) writeFileSync(join(lib, localName(AGENT_FILE)), agent)
  return lib
}

function withFixture(callback, options) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-node-pty-'))
  try {
    const lib = writeTree(root, options)
    return callback({ root, lib })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** Locate the installed agent, following the package that depends on node-pty. */
function installedLibPath() {
  const candidates = ['node-pty/package.json', '@deepseek-ai/dsh-subprocess-local/package.json']
  for (const candidate of candidates) {
    try {
      const manifest = require.resolve(candidate)
      const resolved = createRequire(manifest).resolve('node-pty/package.json')
      const lib = join(dirname(resolved), 'lib')
      readFileSync(join(lib, localName(AGENT_FILE)))
      return lib
    } catch {
      // Try the next anchor.
    }
  }
  return undefined
}

test('the fixtures mirror the real upstream layout', () => {
  const cases = [
    { file: CONOUT_FILE, source: conoutSource(), winpty: false },
    { file: CONOUT_FILE, source: conoutSource({ modern: true }), winpty: false },
    { file: AGENT_FILE, source: agentSource(), winpty: false },
    { file: AGENT_FILE, source: agentSource({ modern: true }), winpty: false },
    { file: AGENT_FILE, source: agentSource({ conptyOnly: false }), winpty: true },
  ]

  for (const { file, source, winpty } of cases) {
    for (const patch of patchesFor(file)) {
      // A skipped ConPTY guard must be genuinely absent, not merely unmatched.
      const expected = patch.conptyOnly === true && winpty ? 0 : 1
      const occurrences = source.split(patch.original).length - 1
      assert.equal(occurrences, expected, `${patch.id} must appear ${String(expected)} time(s) in its fixture`)
    }
  }
})

test('the execArgv edit reaches both shipped call shapes', () => {
  for (const modern of [false, true]) {
    const conout = patchSource(CONOUT_FILE, conoutSource({ modern }))
    assert.equal(conout.status, 'patched', `conout modern=${String(modern)}`)
    assert.match(conout.source, /execArgv: \[\]/)
    assert.ok(conout.source.includes(EXEC_ARGV_MARKER))

    const agent = patchSource(AGENT_FILE, agentSource({ modern }))
    assert.equal(agent.status, 'patched', `agent modern=${String(modern)}`)
    assert.match(agent.source, /\], \{ execArgv: \[\] \/\* PATCH\(dsh-desktop-node-pty-execArgv\) \*\/ \}\);/)
  }
})

test('the guard replaces both unconditional ConPTY tear-downs', () => {
  const result = patchSource(AGENT_FILE, agentSource())

  assert.equal(result.status, 'patched')
  assert.equal((result.source.match(/if \(this\._inSocket\) \{/g) ?? []).length, 2)
  assert.equal((result.source.match(/if \(this\._outSocket\) \{/g) ?? []).length, 2)
  assert.ok(result.source.includes(GUARD_MARKER))
})

test('a winpty-capable agent gets the execArgv edit but no ConPTY guard', () => {
  const result = patchSource(AGENT_FILE, agentSource({ conptyOnly: false }))

  assert.equal(result.status, 'patched')
  assert.ok(result.source.includes(EXEC_ARGV_MARKER))
  assert.equal(result.source.includes(GUARD_MARKER), false)
  assert.equal((result.source.match(/if \(this\._inSocket\) \{/g) ?? []).length, 0)
})

test('patching twice is idempotent', () => {
  for (const [file, source] of [
    [CONOUT_FILE, conoutSource()],
    [AGENT_FILE, agentSource()],
    [AGENT_FILE, agentSource({ conptyOnly: false })],
  ]) {
    const once = patchSource(file, source)
    const twice = patchSource(file, once.source)

    assert.equal(twice.status, 'already-patched', file)
    assert.equal(twice.source, once.source)
  }
})

test('an upstream layout change fails instead of silently under-patching', () => {
  const renamed = conoutSource().replace('{ workerData: workerData }', '{ workerData: settings }')
  const result = patchSource(CONOUT_FILE, renamed)

  assert.equal(result.status, 'unexpected-upstream')
  assert.equal(result.occurrences, 0)
})

test('a duplicated anchor fails instead of half-patching', () => {
  const duplicated = `${agentSource()}${execArgvPatch(AGENT_FILE).original}\n`
  const result = patchSource(AGENT_FILE, duplicated)

  assert.equal(result.status, 'unexpected-upstream')
  assert.equal(result.occurrences, 2)
})

test('the installer patches every file of a node_modules tree on Windows', () => {
  withFixture(({ root, lib }) => {
    const messages = []
    assert.equal(run({ root, platform: 'win32', log: (message) => messages.push(message) }), 0)
    assert.ok(readFileSync(join(lib, localName(CONOUT_FILE)), 'utf8').includes(EXEC_ARGV_MARKER))
    assert.ok(readFileSync(join(lib, localName(AGENT_FILE)), 'utf8').includes(EXEC_ARGV_MARKER))
    assert.equal(messages.length, 2)

    // A second install must not fail or double-patch.
    assert.equal(run({ root, platform: 'win32', log: () => {} }), 0)
    assert.equal(run({ root, platform: 'win32', check: true, log: () => {} }), 0)
  })
})

test('the installer is a no-op away from Windows', () => {
  withFixture(({ root, lib }) => {
    const before = readFileSync(join(lib, localName(CONOUT_FILE)), 'utf8')
    assert.equal(run({ root, platform: 'darwin', log: () => {} }), 0)
    assert.equal(readFileSync(join(lib, localName(CONOUT_FILE)), 'utf8'), before)
  })
})

test('the installer also finds node-pty nested under its Harness dependency', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-node-pty-nested-'))
  try {
    const lib = join(root, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', LIB)
    mkdirSync(lib, { recursive: true })
    writeFileSync(join(lib, localName(CONOUT_FILE)), conoutSource())
    writeFileSync(join(lib, localName(AGENT_FILE)), agentSource())

    assert.equal(run({ root, platform: 'win32', log: () => {} }), 0)
    assert.ok(readFileSync(join(lib, localName(CONOUT_FILE)), 'utf8').includes(EXEC_ARGV_MARKER))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a node-pty lib directory missing a patched file fails loudly', () => {
  withFixture(({ root }) => {
    const skipped = []
    assert.equal(run({ root, platform: 'win32', log: (message) => skipped.push(message) }), 1)
    assert.ok(skipped.some((message) => message.includes('is missing')))
  }, { agent: null })
})

test('check mode reports an unpatched and an absent tree as failures', () => {
  withFixture(({ root }) => {
    assert.equal(run({ root, platform: 'win32', check: true, log: () => {} }), 1)
    assert.equal(run({ root, platform: 'win32', log: () => {} }), 0)
    assert.equal(run({ root, platform: 'win32', check: true, log: () => {} }), 0)
  })

  const emptyRoot = mkdtempSync(join(tmpdir(), 'dsh-node-pty-empty-'))
  try {
    assert.equal(run({ root: emptyRoot, platform: 'win32', log: () => {} }), 1)
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true })
  }
})

/**
 * The patch is Windows-only by design: `run()` returns before touching anything
 * on another platform, so this assertion is only meaningful where it installs.
 */
const packagedTreeSkipReason =
  process.platform !== 'win32'
    ? `the node-pty patch is Windows-only (running on ${process.platform})`
    : installedLibPath() === undefined
      ? 'node-pty is not installed'
      : false

test('the packaged tree ships the patch, not the crash', { skip: packagedTreeSkipReason }, () => {
  const lib = installedLibPath()

  for (const file of [CONOUT_FILE, AGENT_FILE]) {
    const source = readFileSync(join(lib, localName(file)), 'utf8')
    assert.ok(
      source.includes(EXEC_ARGV_MARKER),
      `run \`npm install\` to apply the node-pty patch to ${file} before packaging`,
    )
    assert.notEqual(patchSource(file, source).status, 'unexpected-upstream')
  }
})
