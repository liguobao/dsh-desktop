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
  runGit,
  runPnpm,
  setPluginEnabled,
  updatePlugin,
} from '../src/plugin-management.js'

const mainUrl = new URL('../src/main.js', import.meta.url)
const serviceUrl = new URL('../src/plugin-management.js', import.meta.url)
const preloadUrl = new URL('../src/plugin-preload.cjs', import.meta.url)
const pageUrl = new URL('../src/pages/plugins.html', import.meta.url)
const extensionPreloadUrl = new URL('../src/extension-preload.cjs', import.meta.url)
const extensionPageUrl = new URL('../src/pages/extensions.html', import.meta.url)

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

test('accepts GitHub repository addresses with optional revisions', () => {
  assert.deepEqual(normalizePluginSpec('https://github.com/liguobao/deepseek-harness-remote'), {
    spec: 'github:liguobao/deepseek-harness-remote',
    source: 'github',
    repository: 'liguobao/deepseek-harness-remote',
  })
  assert.deepEqual(normalizePluginSpec('https://github.com/liguobao/deepseek-harness-remote/commit/2d0d9ece1345ff0a80414ee35fe411d35d4b38ac'), {
    spec: 'github:liguobao/deepseek-harness-remote#2d0d9ece1345ff0a80414ee35fe411d35d4b38ac',
    source: 'github',
    repository: 'liguobao/deepseek-harness-remote',
    ref: '2d0d9ece1345ff0a80414ee35fe411d35d4b38ac',
  })
  assert.deepEqual(normalizePluginSpec('https://github.com/liguobao/deepseek-harness-remote/tree/v0.2.5'), {
    spec: 'github:liguobao/deepseek-harness-remote#v0.2.5',
    source: 'github',
    repository: 'liguobao/deepseek-harness-remote',
    ref: 'v0.2.5',
  })
  assert.deepEqual(normalizePluginSpec('https://github.com/liguobao/deepseek-harness-remote#v0.2.5'), {
    spec: 'github:liguobao/deepseek-harness-remote#v0.2.5',
    source: 'github',
    repository: 'liguobao/deepseek-harness-remote',
    ref: 'v0.2.5',
  })
  assert.deepEqual(normalizePluginSpec('github:example/dsh-tools'), {
    spec: 'github:example/dsh-tools',
    source: 'github',
    repository: 'example/dsh-tools',
  })
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
  assert.deepEqual(normalizePluginSpec('https://github.com/example/dsh-tools/releases/tag/v2.0.0?source=release'), {
    spec: 'github:example/dsh-tools#v2.0.0',
    source: 'github',
    repository: 'example/dsh-tools',
    ref: 'v2.0.0',
  })
  assert.deepEqual(normalizePluginSpec('https://github.com/example/dsh-tools/tree/feature/new-ui'), {
    spec: 'github:example/dsh-tools#feature/new-ui',
    source: 'github',
    repository: 'example/dsh-tools',
    ref: 'feature/new-ui',
  })
  assert.throws(() => normalizePluginSpec('https://github.com/example/dsh-tools/issues'), /repository, commit, or tree/)
  assert.throws(() => normalizePluginSpec('https://github.com/example/dsh-tools/blob/main/package.json'), /repository, commit, or tree/)
  assert.throws(() => normalizePluginSpec('https://github.com/example/dsh-tools/commit/not-a-commit'), /repository, commit, or tree/)
  assert.throws(() => normalizePluginSpec('https://github.com/example/dsh-tools#../main'), /Invalid GitHub revision/)
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

test('installs the latest GitHub tag, optionally permits build scripts, and enables the bundle', async (t) => {
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
  const gitCalls = []
  const commit = '8f90abc1234567890abc1234567890abc1234567'
  const runGitImpl = async ({ args }) => {
    gitCalls.push(args)
    return { output: `${commit}\trefs/tags/v2.0.0\n1234567890abcdef1234567890abcdef12345678\trefs/tags/v1.9.0\n` }
  }
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
    spec: 'https://github.com/example/dsh-tools',
    allowBuildScripts: true,
    runGitImpl,
    runPnpmImpl,
  })
  assert.deepEqual(gitCalls, [[
    'ls-remote', '--tags', '--refs', '--sort=-version:refname', 'https://github.com/example/dsh-tools.git',
  ]])
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], ['add', '--save-prod', '--reporter', 'append-only', '--ignore-scripts', 'github:example/dsh-tools#v2.0.0'])
  assert.ok(calls[1].includes('--allow-build=@example/github-plugin@git+https://github.com/example/dsh-tools.git'))
  assert.equal(calls[1].at(-1), `github:example/dsh-tools#${commit}`)
  assert.equal(catalog.plugins[0].source, 'github')
  assert.equal(catalog.plugins[0].enabled, true)
  assert.equal(catalog.plugins[0].requested, `github:example/dsh-tools#${commit}`)
})

test('reports a GitHub repository without tags before installing it', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  writeJson(join(profileDir, 'package.json'), {
    name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  })
  await assert.rejects(() => installPlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    spec: 'github:example/no-tags',
    runGitImpl: async () => ({ output: '' }),
    runPnpmImpl: async () => assert.fail('pnpm should not run without a tag'),
  }), /has no tags/)
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
      name: 'github-plugin',
      version: '1.0.0',
      scripts: { prepare: 'node build.js' },
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
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

test('enables a prebuilt GitHub bundle when pnpm reports only a packlist build warning', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  const commit = 'abcdef1234567890abcdef1234567890abcdef12'
  writeJson(profileManifest, {
    name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  })
  const runPnpmImpl = async ({ args }) => {
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    manifest.dependencies['prebuilt-plugin'] = args.at(-1)
    writeJson(profileManifest, manifest)
    writeJson(join(profileDir, 'node_modules', 'prebuilt-plugin', 'package.json'), {
      name: 'prebuilt-plugin', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      prebuilt-plugin:\n        specifier: ${JSON.stringify(args.at(-1))}\n        version: https://codeload.github.com/example/prebuilt-plugin/tar.gz/${commit}\n`)
    return { output: '[WARN] The git-hosted package has to be built but the build scripts were ignored.' }
  }

  const catalog = await installPlugin({
    dshHome, pnpmEntry: '/pnpm.mjs', spec: 'github:example/prebuilt-plugin#v1.0.0', runPnpmImpl,
  })
  assert.equal(catalog.buildScriptsIgnored, false)
  assert.equal(catalog.plugins[0].bundle, true)
  assert.equal(catalog.plugins[0].enabled, true)
})

test('replaces an older package name from the same GitHub plugin repository', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  const oldName = 'deepseek-harness-remote'
  const newName = 'dsh-remote'
  const commit = '1234567890abcdef1234567890abcdef12345678'
  writeJson(profileManifest, {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { [oldName]: 'github:liguobao/deepseek-harness-remote#v0.2.1' },
    dsh: { profile: { bundles: [oldName] } },
  })
  writeJson(join(profileDir, 'node_modules', oldName, 'package.json'), {
    name: oldName, version: '0.2.1', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  })
  const calls = []
  const runPnpmImpl = async ({ args }) => {
    calls.push(args)
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    if (args[0] === 'add') {
      manifest.dependencies[newName] = args.at(-1)
      writeJson(join(profileDir, 'node_modules', newName, 'package.json'), {
        name: newName, version: '0.2.2', dsh: { bundle: { patch: 'cordis.patch.yml' } },
      })
      writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      ${newName}:\n        specifier: ${JSON.stringify(args.at(-1))}\n        version: https://codeload.github.com/liguobao/deepseek-harness-remote/tar.gz/${commit}\n`)
    } else {
      delete manifest.dependencies[oldName]
    }
    writeJson(profileManifest, manifest)
    return { output: '' }
  }

  const catalog = await installPlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    spec: 'github:liguobao/deepseek-harness-remote#v0.2.2',
    runPnpmImpl,
  })

  assert.equal(calls.length, 3)
  assert.deepEqual(calls[2], ['remove', '--reporter', 'append-only', oldName])
  assert.deepEqual(catalog.plugins.map(plugin => plugin.name), [newName])
  assert.equal(catalog.plugins[0].enabled, true)
  const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, [newName])
})

test('updates a GitHub plugin from the default branch and preserves its disabled state', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  const oldCommit = '1111111111111111111111111111111111111111'
  const newCommit = '2222222222222222222222222222222222222222'
  writeJson(profileManifest, {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { '@example/github-plugin': `github:example/dsh-tools#${oldCommit}` },
    dsh: { profile: { bundles: [] } },
  })
  writeJson(join(profileDir, 'node_modules', '@example', 'github-plugin', 'package.json'), {
    name: '@example/github-plugin', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  })
  const gitCalls = []
  const runGitImpl = async ({ args }) => {
    gitCalls.push(args)
    return { output: `ref: refs/heads/main\tHEAD\n${newCommit}\tHEAD\n` }
  }
  const pnpmCalls = []
  const runPnpmImpl = async ({ args }) => {
    pnpmCalls.push(args)
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    manifest.dependencies['@example/github-plugin'] = args.at(-1)
    writeJson(profileManifest, manifest)
    writeJson(join(profileDir, 'node_modules', '@example', 'github-plugin', 'package.json'), {
      name: '@example/github-plugin', version: '2.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      "@example/github-plugin":\n        specifier: ${JSON.stringify(args.at(-1))}\n        version: https://codeload.github.com/example/dsh-tools/tar.gz/${newCommit}\n`)
    return { output: '' }
  }

  const catalog = await updatePlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    name: '@example/github-plugin',
    runGitImpl,
    runPnpmImpl,
  })
  assert.deepEqual(gitCalls, [[
    'ls-remote', '--symref', 'https://github.com/example/dsh-tools.git', 'HEAD',
  ]])
  assert.equal(pnpmCalls.length, 2)
  assert.equal(pnpmCalls[0].at(-1), `github:example/dsh-tools#${newCommit}`)
  assert.equal(catalog.upToDate, false)
  assert.equal(catalog.plugins[0].requested, `github:example/dsh-tools#${newCommit}`)
  assert.equal(catalog.plugins[0].enabled, false)

  const unchanged = await updatePlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    name: '@example/github-plugin',
    runGitImpl,
    runPnpmImpl: async () => assert.fail('pnpm should not run when the plugin is current'),
  })
  assert.equal(unchanged.upToDate, true)
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

test('queries GitHub refs through git without a shell or credential prompts', async () => {
  let invocation
  const spawn = (command, args, options) => {
    invocation = { command, args, options }
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    queueMicrotask(() => {
      child.stdout.write('abc123\tHEAD\n')
      child.stdout.end()
      child.stderr.end()
      child.emit('exit', 0, null)
    })
    return child
  }

  const result = await runGit({
    args: ['ls-remote', 'https://github.com/example/repository.git', 'HEAD'],
    cwd: '/profile/web',
    env: { PATH: '/usr/bin' },
    spawnImpl: spawn,
  })
  assert.equal(result.output, 'abc123\tHEAD\n')
  assert.equal(invocation.command, 'git')
  assert.deepEqual(invocation.args, ['ls-remote', 'https://github.com/example/repository.git', 'HEAD'])
  assert.equal(invocation.options.shell, false)
  assert.equal(invocation.options.env.GIT_TERMINAL_PROMPT, '0')
  assert.equal(invocation.options.env.GCM_INTERACTIVE, 'Never')
})

test('limits plugin and extension IPC to separate local pages and fixed operations', () => {
  const main = readFileSync(mainUrl, 'utf8')
  const service = readFileSync(serviceUrl, 'utf8')
  const preload = readFileSync(preloadUrl, 'utf8')
  const page = readFileSync(pageUrl, 'utf8')
  const extensionPreload = readFileSync(extensionPreloadUrl, 'utf8')
  const extensionPage = readFileSync(extensionPageUrl, 'utf8')
  assert.match(main, /senderIsPluginManager\(event\)/)
  assert.match(main, /senderIsExtensionManager\(event\)/)
  assert.match(main, /pagePath\('plugins\.html'\)/)
  assert.match(main, /pagePath\('extensions\.html'\)/)
  assert.match(main, /managePlugins: '插件安装'/)
  assert.match(main, /manageExtensions: 'Skills管理'/)
  assert.match(main, /dsh-desktop:plugins-update/)
  assert.match(service, /shell: false/)
  assert.match(preload, /dsh-desktop:plugins-install/)
  assert.match(preload, /dsh-desktop:plugins-update/)
  assert.match(preload, /dsh-desktop:plugins-enabled/)
  assert.match(preload, /dsh-desktop:plugins-remove/)
  assert.doesNotMatch(preload, /dsh-desktop:skills-/)
  assert.match(extensionPreload, /dsh-desktop:skills-create/)
  assert.match(extensionPreload, /dsh-desktop:skills-enabled/)
  assert.match(extensionPreload, /dsh-desktop:skills-remove/)
  assert.doesNotMatch(extensionPreload, /dsh-desktop:plugins-/)
  assert.doesNotMatch(preload, /child_process|exec\(|spawn\(/)
  assert.doesNotMatch(extensionPreload, /child_process|exec\(|spawn\(/)
  assert.doesNotMatch(page, /\.innerHTML\s*=/)
  assert.doesNotMatch(extensionPage, /\.innerHTML\s*=/)
})
