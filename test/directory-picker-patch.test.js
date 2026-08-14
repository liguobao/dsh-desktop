import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)

test('Windows directory picker avoids Electron-incompatible external buffers', () => {
  const workerPath = require.resolve('@deepseek-ai/dsh-host-directory-picker-native/worker')
  const workerSource = readFileSync(workerPath, 'utf8')

  assert.doesNotMatch(workerSource, /Buffer\.from\(koffi\.view\(/)
  assert.match(workerSource, /koffi\.decode\.string16\(address\)/)
})

test('Koffi decodes UTF-16 pointers inside Electron run-as-node', () => {
  const electronPath = require('electron')
  const script = [
    "const koffi = require('koffi')",
    "const expected = 'C:\\\\workspaces\\\\\u6d4b\u8bd5'",
    "const bytes = Buffer.from(expected + '\\0', 'utf16le')",
    'const actual = koffi.decode.string16(koffi.address(bytes))',
    'if (actual !== expected) throw new Error(`decoded ${JSON.stringify(actual)}`)',
  ].join(';')
  const result = spawnSync(electronPath, ['--eval', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
})
