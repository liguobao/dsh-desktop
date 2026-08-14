import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  installPlugin,
  normalizePluginSpec,
  readPluginCatalog,
  removePlugin,
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
    source: 'npm',
  })
  assert.deepEqual(normalizePluginSpec('dsh-plugin@latest'), {
    spec: 'dsh-plugin@latest',
    packageName: 'dsh-plugin',
    source: 'npm',
  })
  assert.throws(() => normalizePluginSpec('--global'), /Invalid plugin package/)
  assert.throws(() => normalizePluginSpec('../plugin'), /npm package name/)
  assert.throws(() => normalizePluginSpec('https://example.com/plugin.tgz'), /npm package name/)
  assert.throws(() => normalizePluginSpec('plugin name'), /Invalid plugin package/)
  assert.throws(() => normalizePluginSpec('@deepseek-ai/dsh-base'), /System bundles are managed/)
})

test('accepts only pinned GitHub plugin sources', () => {
  assert.deepEqual(normalizePluginSpec('https://github.com/example/dsh-tools.git#v1.2.3'), {
    spec: 'github:example/dsh-tools#v1.2.3',
    source: 'github',
    repository: 'example/dsh-tools',
    ref: 'v1.2.3',
  })
  assert.deepEqual(normalizePluginSpec('github:example/dsh-tools#8f90abc'), {
    spec: 'github:example/dsh-tools#8f90abc',
    source: 'github',
    repository: 'example/dsh-tools',
    ref: '8f90abc',
  })
  assert.throws(() => normalizePluginSpec('github:example/dsh-tools'), /tag-or-commit/)
  assert.throws(() => normalizePluginSpec('https://github.com/example/dsh-tools#../main'), /tag-or-commit/)
  assert.throws(() => normalizePluginSpec('git@github.com:example/dsh-tools.git'), /npm package name/)
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
  assert.equal(catalog.plugins[0].source, 'npm')
  assert.equal(catalog.plugins[1].bundle, false)

  setPluginEnabled({ dshHome, name: '@example/plugin', enabled: false })
  catalog = readPluginCatalog({ dshHome })
  assert.equal(catalog.plugins[0].enabled, false)
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  assert.throws(() => setPluginEnabled({ dshHome, name: '@example/library', enabled: true }), /does not declare a DSH bundle/)
  assert.throws(() => setPluginEnabled({ dshHome, name: '@deepseek-ai/dsh-base', enabled: false }), /System bundles cannot be changed/)
})

test('identifies a GitHub package, optionally permits its build scripts, and enables its bundle', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  writeJson(profileManifest, {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { '@deepseek-ai/dsh-base': '0.1.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  })
  const calls = []
  const commit = '8f90abc1234567890abc1234567890abc1234567'
  const runPnpmImpl = async ({ args }) => {
    calls.push(args)
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    manifest.dependencies['@example/github-plugin'] = args.at(-1)
    writeJson(profileManifest, manifest)
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      "@example/github-plugin":\n        specifier: ${JSON.stringify(args.at(-1))}\n        version: https://codeload.github.com/example/dsh-tools/tar.gz/${commit}\n`)
    writeJson(join(profileDir, 'node_modules', '@example', 'github-plugin', 'package.json'), {
      name: '@example/github-plugin',
      version: '2.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
    return { output: '' }
  }

  const catalog = await installPlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    spec: 'github:example/dsh-tools#v2.0.0',
    allowBuildScripts: true,
    runPnpmImpl,
  })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], ['add', '--save-prod', '--reporter', 'append-only', '--ignore-scripts', 'github:example/dsh-tools#v2.0.0'])
  assert.ok(calls[1].includes('--allow-build=@example/github-plugin@git+https://github.com/example/dsh-tools.git'))
  assert.equal(calls[1].at(-1), `github:example/dsh-tools#${commit}`)
  assert.equal(catalog.plugins[0].source, 'github')
  assert.equal(catalog.plugins[0].enabled, true)
  assert.equal(catalog.plugins[0].requested, `github:example/dsh-tools#${commit}`)
})

test('keeps a GitHub bundle disabled when its required build scripts were not approved', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  const commit = '1234567890abcdef1234567890abcdef12345678'
  writeJson(profileManifest, {
    name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  })
  let invocation = 0
  const runPnpmImpl = async ({ args }) => {
    invocation += 1
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    manifest.dependencies['github-plugin'] = args.at(-1)
    writeJson(profileManifest, manifest)
    writeJson(join(profileDir, 'node_modules', 'github-plugin', 'package.json'), {
      name: 'github-plugin', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      github-plugin:\n        specifier: ${JSON.stringify(args.at(-1))}\n        version: https://codeload.github.com/example/github-plugin/tar.gz/${commit}\n`)
    return { output: invocation === 1 ? '[ERR_PNPM_IGNORED_BUILDS] build scripts were ignored' : '' }
  }

  const catalog = await installPlugin({
    dshHome, pnpmEntry: '/pnpm.mjs', spec: 'github:example/github-plugin#v1.0.0', runPnpmImpl,
  })
  assert.equal(invocation, 2)
  assert.equal(catalog.buildScriptsIgnored, true)
  assert.equal(catalog.plugins[0].enabled, false)
})

test('removes only the build permission granted for an uninstalled GitHub plugin', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  writeJson(profileManifest, {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { '@example/github-plugin': 'github:example/dsh-tools#v2.0.0' },
    dsh: { profile: { bundles: ['@example/github-plugin'] } },
  })
  writeJson(join(profileDir, 'node_modules', '@example', 'github-plugin', 'package.json'), {
    name: '@example/github-plugin', version: '2.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  })
  const permission = '@example/github-plugin@git+https://github.com/example/dsh-tools.git'
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), `allowBuilds:\n  ${JSON.stringify(permission)}: true\n  esbuild: true\n`)
  const runPnpmImpl = async () => {
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    delete manifest.dependencies['@example/github-plugin']
    writeJson(profileManifest, manifest)
    return { output: '' }
  }

  await removePlugin({ dshHome, pnpmEntry: '/pnpm.mjs', name: '@example/github-plugin', runPnpmImpl })
  const workspace = readFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
  assert.doesNotMatch(workspace, /github-plugin/)
  assert.match(workspace, /esbuild: true/)
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
  assert.match(preload, /dsh-desktop:skills-create/)
  assert.match(preload, /dsh-desktop:skills-enabled/)
  assert.match(preload, /dsh-desktop:skills-remove/)
  assert.doesNotMatch(preload, /child_process|exec\(|spawn\(/)
  assert.doesNotMatch(page, /\.innerHTML\s*=/)
})
