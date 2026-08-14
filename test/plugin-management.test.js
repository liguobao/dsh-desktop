import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  normalizePluginSpec,
  readPluginCatalog,
  runPnpm,
  setPluginEnabled,
} from '../src/plugin-management.js'

const mainUrl = new URL('../src/main.js', import.meta.url)
const serviceUrl = new URL('../src/plugin-management.js', import.meta.url)
const preloadUrl = new URL('../src/plugin-preload.cjs', import.meta.url)
const pageUrl = new URL('../src/pages/plugins.html', import.meta.url)

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-plugin-manager-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

test('accepts registry plugin specs and rejects command or path input', () => {
  assert.deepEqual(normalizePluginSpec('@example/dsh-tools@1.2.3'), {
    spec: '@example/dsh-tools@1.2.3',
    packageName: '@example/dsh-tools',
  })
  assert.deepEqual(normalizePluginSpec('dsh-plugin@latest'), {
    spec: 'dsh-plugin@latest',
    packageName: 'dsh-plugin',
  })
  assert.throws(() => normalizePluginSpec('--global'), /Invalid plugin package/)
  assert.throws(() => normalizePluginSpec('../plugin'), /npm package name/)
  assert.throws(() => normalizePluginSpec('https://example.com/plugin.tgz'), /npm package name/)
  assert.throws(() => normalizePluginSpec('plugin name'), /Invalid plugin package/)
  assert.throws(() => normalizePluginSpec('@deepseek-ai/dsh-base'), /System bundles are managed/)
})

test('reads profile dependencies and toggles only DSH bundle packages', (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  writeJson(join(profileDir, 'package.json'), {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {
      '@example/plugin': '1.2.3',
      '@example/library': '^4.0.0',
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@example/plugin'] } },
  })
  writeJson(join(profileDir, 'node_modules', '@example', 'plugin', 'package.json'), {
    name: '@example/plugin', version: '1.2.3', description: 'Example tools', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  })
  writeJson(join(profileDir, 'node_modules', '@example', 'library', 'package.json'), {
    name: '@example/library', version: '4.0.1', description: 'Plain library',
  })

  let catalog = readPluginCatalog({ dshHome })
  assert.deepEqual(catalog.system.map(plugin => plugin.name), ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  assert.equal(catalog.plugins[0].enabled, true)
  assert.equal(catalog.plugins[0].bundle, true)
  assert.equal(catalog.plugins[1].bundle, false)

  setPluginEnabled({ dshHome, name: '@example/plugin', enabled: false })
  catalog = readPluginCatalog({ dshHome })
  assert.equal(catalog.plugins[0].enabled, false)
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  assert.throws(() => setPluginEnabled({ dshHome, name: '@example/library', enabled: true }), /does not declare a DSH bundle/)
  assert.throws(() => setPluginEnabled({ dshHome, name: '@deepseek-ai/dsh-base', enabled: false }), /System bundles cannot be changed/)
})

test('runs bundled pnpm through the desktop executable without a shell', async () => {
  let invocation
  const controller = new AbortController()
  const spawn = (command, args, options) => {
    invocation = { command, args, options }
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    queueMicrotask(() => {
      child.stdout.write('installed\n')
      child.stdout.end()
      child.stderr.end()
      child.emit('exit', 0, null)
    })
    return child
  }

  const result = await runPnpm({
    args: ['add', '@example/plugin'],
    execPath: '/app/dsh-desktop',
    pnpmEntry: '/app/resources/pnpm/bin/pnpm.mjs',
    profileDir: '/profile/web',
    env: { PATH: '/usr/bin' },
    signal: controller.signal,
    spawnImpl: spawn,
  })
  assert.equal(result.output, 'installed\n')
  assert.equal(invocation.command, '/app/dsh-desktop')
  assert.deepEqual(invocation.args, ['/app/resources/pnpm/bin/pnpm.mjs', 'add', '@example/plugin'])
  assert.equal(invocation.options.cwd, '/profile/web')
  assert.equal(invocation.options.shell, false)
  assert.equal(invocation.options.signal, controller.signal)
  assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1')
})

test('limits plugin IPC to the dedicated local page and fixed operations', () => {
  const main = readFileSync(mainUrl, 'utf8')
  const service = readFileSync(serviceUrl, 'utf8')
  const preload = readFileSync(preloadUrl, 'utf8')
  const page = readFileSync(pageUrl, 'utf8')
  assert.match(main, /senderIsPluginManager\(event\)/)
  assert.match(main, /pagePath\('plugins\.html'\)/)
  assert.match(service, /shell: false/)
  assert.match(preload, /dsh-desktop:plugins-install/)
  assert.match(preload, /dsh-desktop:plugins-enabled/)
  assert.match(preload, /dsh-desktop:plugins-remove/)
  assert.doesNotMatch(preload, /child_process|exec\(|spawn\(/)
  assert.doesNotMatch(page, /\.innerHTML\s*=/)
})
