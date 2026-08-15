import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  checkForDshUpdate,
  deactivateManagedDsh,
  installDshVersion,
  parseDshRegistryVersion,
  readActiveDshRuntime,
} from '../src/dsh-runtime.js'

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-runtime-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function writeDshPackage(directory, version) {
  const packageDirectory = join(directory, 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(join(packageDirectory, 'lib'), { recursive: true })
  writeFileSync(join(packageDirectory, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh',
    version,
  })}\n`)
  writeFileSync(join(packageDirectory, 'lib', 'bin.js'), '// dsh\n')
  return join(packageDirectory, 'package.json')
}

test('active DSH runtime falls back to the bundled package when no managed version is selected', (t) => {
  const root = temporaryDirectory(t)
  const bundledManifestPath = writeDshPackage(join(root, 'bundled'), '1.0.0')
  const runtimeRoot = join(root, 'runtime')

  const runtime = readActiveDshRuntime({ runtimeRoot, bundledManifestPath })

  assert.equal(runtime.source, 'bundled')
  assert.equal(runtime.version, '1.0.0')
  assert.equal(runtime.managedError, undefined)
})

test('active DSH runtime accepts only a verified app-managed version directory', (t) => {
  const root = temporaryDirectory(t)
  const bundledManifestPath = writeDshPackage(join(root, 'bundled'), '1.0.0')
  const runtimeRoot = join(root, 'runtime')
  writeDshPackage(join(runtimeRoot, 'versions', '1.1.0'), '1.1.0')
  mkdirSync(dirname(join(runtimeRoot, 'active.json')), { recursive: true })
  writeFileSync(join(runtimeRoot, 'active.json'), '{"version":"1.1.0"}\n')

  const runtime = readActiveDshRuntime({ runtimeRoot, bundledManifestPath })
  assert.equal(runtime.source, 'managed')
  assert.equal(runtime.version, '1.1.0')

  writeFileSync(join(runtimeRoot, 'active.json'), '{"version":"../outside"}\n')
  const fallback = readActiveDshRuntime({ runtimeRoot, bundledManifestPath })
  assert.equal(fallback.source, 'bundled')
  assert.match(fallback.managedError, /Invalid DSH version/)
})

test('registry version parser accepts pnpm JSON and rejects ambiguous output', () => {
  assert.equal(parseDshRegistryVersion('"0.1.0-rc.6"\n'), '0.1.0-rc.6')
  assert.equal(parseDshRegistryVersion('warning\n{"version":"1.2.3"}\n'), '1.2.3')
  assert.throws(() => parseDshRegistryVersion('latest'), /invalid DSH version/)
})

test('DSH update check compares the running version with npm latest', async (t) => {
  const runtimeRoot = temporaryDirectory(t)
  const calls = []
  const result = await checkForDshUpdate({
    currentVersion: '0.1.0-rc.5',
    runtimeRoot,
    pnpmEntry: '/pnpm.mjs',
    runPnpmImpl: async options => {
      calls.push(options)
      return { output: '"0.1.0-rc.6"\n' }
    },
  })

  assert.equal(result.available, true)
  assert.equal(result.latestVersion, '0.1.0-rc.6')
  assert.deepEqual(calls[0].args, ['view', '@deepseek-ai/dsh', 'version', '--json'])
  assert.equal(calls[0].profileDir, runtimeRoot)
})

test('DSH installation stages, verifies, activates, and reuses an exact npm version', async (t) => {
  const runtimeRoot = temporaryDirectory(t)
  const calls = []
  let workspace
  const options = {
    version: '1.2.3',
    runtimeRoot,
    pnpmEntry: '/pnpm.mjs',
    runPnpmImpl: async invocation => {
      calls.push(invocation)
      workspace = readFileSync(join(invocation.profileDir, 'pnpm-workspace.yaml'), 'utf8')
      writeDshPackage(invocation.profileDir, '1.2.3')
      return { output: '' }
    },
  }

  const installed = await installDshVersion(options)
  assert.equal(installed.version, '1.2.3')
  assert.equal(installed.reused, false)
  assert.match(workspace, /node-pty: true/)
  assert.match(workspace, /"@google\/genai": false/)
  assert.equal(calls[0].args.at(-1), '@deepseek-ai/dsh@1.2.3')
  assert.deepEqual(JSON.parse(readFileSync(join(runtimeRoot, 'active.json'), 'utf8')), { version: '1.2.3' })

  const reused = await installDshVersion(options)
  assert.equal(reused.reused, true)
  assert.equal(calls.length, 1)

  deactivateManagedDsh(runtimeRoot)
  assert.equal(readFileSync(join(installed.manifestPath), 'utf8').includes('1.2.3'), true)
})
