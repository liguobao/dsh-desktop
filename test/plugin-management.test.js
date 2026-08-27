import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  DEFAULT_PLUGINS,
  ensureDefaultPlugins,
  ensureProfileInitialized,
  installBundledFileViewerPlugin,
  installPlugin,
  installBundledRemotePlugin,
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

test('keeps bundled desktop plugins out of online default installs', () => {
  assert.deepEqual(DEFAULT_PLUGINS, [])
})

test('seeds the bundled remote plugin with runtime dependencies and a registry source', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const sourceDir = join(directory, 'app', 'node_modules', 'ds-harness-remote')
  const dependencyDir = join(directory, 'app', 'node_modules', 'werift')
  writeJson(join(sourceDir, 'package.json'), {
    name: 'ds-harness-remote', version: '0.3.35', dependencies: { werift: '0.24.4' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(sourceDir, 'index.js'), 'export {}\n')
  writeJson(join(dependencyDir, 'package.json'), { name: 'werift', version: '0.24.4' })

  await installBundledRemotePlugin({ dshHome, sourceDir })

  const profileDir = join(dshHome, 'profiles', 'web')
  const catalog = readPluginCatalog({ dshHome })
  assert.equal(catalog.plugins[0].name, 'ds-harness-remote')
  assert.equal(catalog.plugins[0].source, 'npm')
  assert.equal(catalog.plugins[0].enabled, true)
  assert.equal(readFileSync(join(profileDir, 'node_modules', 'ds-harness-remote', 'index.js'), 'utf8'), 'export {}\n')
  assert.equal(JSON.parse(readFileSync(join(profileDir, 'node_modules', 'werift', 'package.json'))).version, '0.24.4')
  assert.match(readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8'), /version: 0\.3\.35/)

  let profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  profileManifest.dependencies['ds-harness-remote'] = 'github:liguobao/deepseek-harness-remote#ae70ff87afd0ac176f0f4105b23a417a97a1dd04'
  writeFileSync(join(profileDir, 'node_modules', 'ds-harness-remote', 'index.js'), 'stale\n')
  writeJson(join(profileDir, 'package.json'), profileManifest)
  await installBundledRemotePlugin({ dshHome, sourceDir })
  profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.equal(
    profileManifest.dependencies['ds-harness-remote'],
    '0.3.35',
  )
  assert.equal(readFileSync(join(profileDir, 'node_modules', 'ds-harness-remote', 'index.js'), 'utf8'), 'export {}\n')

  profileManifest.dependencies['ds-harness-remote'] = 'github:liguobao/deepseek-harness-remote#newer-commit'
  writeJson(join(profileDir, 'package.json'), profileManifest)
  await installBundledRemotePlugin({ dshHome, sourceDir })
  assert.equal(
    JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies['ds-harness-remote'],
    'github:liguobao/deepseek-harness-remote#newer-commit',
  )
})

test('seeds the bundled remote plugin when an older release marked the default as seen', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const profileDir = join(dshHome, 'profiles', 'web')
  const sourceDir = join(directory, 'app', 'node_modules', 'ds-harness-remote')
  ensureProfileInitialized(dshHome)
  writeJson(join(profileDir, '.dsh-desktop-default-plugins.json'), {
    version: 1,
    seen: ['github:liguobao/deepseek-harness-remote'],
  })
  writeJson(join(sourceDir, 'package.json'), {
    name: 'ds-harness-remote', version: '0.3.35',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(sourceDir, 'index.js'), 'export {}\n')

  await installBundledRemotePlugin({ dshHome, sourceDir })

  const catalog = readPluginCatalog({ dshHome })
  assert.equal(catalog.plugins[0].name, 'ds-harness-remote')
  assert.equal(catalog.plugins[0].enabled, true)
  assert.equal(catalog.plugins[0].installed, true)
})

test('upgrades an older exact bundled remote version from the desktop bundle', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const profileDir = ensureProfileInitialized(dshHome)
  const sourceDir = join(directory, 'app', 'node_modules', 'ds-harness-remote')
  const targetDir = join(profileDir, 'node_modules', 'ds-harness-remote')
  const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  profileManifest.dependencies['ds-harness-remote'] = '0.3.33'
  profileManifest.dsh.profile.bundles.push('ds-harness-remote')
  writeJson(join(profileDir, 'package.json'), profileManifest)
  writeJson(join(targetDir, 'package.json'), {
    name: 'ds-harness-remote', version: '0.3.33', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(targetDir, 'legacy.js'), 'old\n')
  writeJson(join(sourceDir, 'package.json'), {
    name: 'ds-harness-remote', version: '0.3.35', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(sourceDir, 'index.js'), 'new\n')

  await installBundledRemotePlugin({ dshHome, sourceDir })

  const plugin = readPluginCatalog({ dshHome }).plugins[0]
  assert.equal(plugin.requested, '0.3.35')
  assert.equal(plugin.source, 'npm')
  assert.equal(plugin.version, '0.3.35')
  assert.equal(existsSync(join(targetDir, 'legacy.js')), false)
  assert.equal(readFileSync(join(targetDir, 'index.js'), 'utf8'), 'new\n')
})

test('seeds the bundled file viewer with its runtime dependency closure and a registry source', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const sourceDir = join(directory, 'app', 'node_modules', 'dsh-file-viewer')
  const dependencyDir = join(directory, 'app', 'node_modules', 'markdown-it')
  writeJson(join(sourceDir, 'package.json'), {
    name: 'dsh-file-viewer', version: '0.2.5', dependencies: { 'markdown-it': '14.1.0' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(sourceDir, 'index.js'), 'export {}\n')
  writeJson(join(dependencyDir, 'package.json'), { name: 'markdown-it', version: '14.1.0' })

  await installBundledFileViewerPlugin({
    dshHome,
    sourceDir,
  })

  const profileDir = join(dshHome, 'profiles', 'web')
  const catalog = readPluginCatalog({ dshHome })
  assert.equal(catalog.plugins[0].name, 'dsh-file-viewer')
  assert.equal(catalog.plugins[0].source, 'npm')
  assert.equal(catalog.plugins[0].version, '0.2.5')
  assert.equal(catalog.plugins[0].enabled, true)
  assert.equal(readFileSync(join(profileDir, 'node_modules', 'dsh-file-viewer', 'index.js'), 'utf8'), 'export {}\n')
  assert.equal(JSON.parse(readFileSync(join(profileDir, 'node_modules', 'markdown-it', 'package.json'))).version, '14.1.0')
  assert.equal(JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies['dsh-file-viewer'], '0.2.5')
  assert.match(readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8'), /version: 0\.2\.5/)
})

test('upgrades an older exact bundled file viewer version from the desktop bundle', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const profileDir = ensureProfileInitialized(dshHome)
  const sourceDir = join(directory, 'app', 'node_modules', 'dsh-file-viewer')
  const targetDir = join(profileDir, 'node_modules', 'dsh-file-viewer')
  const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  profileManifest.dependencies['dsh-file-viewer'] = '0.2.4'
  profileManifest.dsh.profile.bundles.push('dsh-file-viewer')
  writeJson(join(profileDir, 'package.json'), profileManifest)
  writeJson(join(targetDir, 'package.json'), {
    name: 'dsh-file-viewer', version: '0.2.4', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(targetDir, 'legacy.js'), 'old\n')
  writeJson(join(sourceDir, 'package.json'), {
    name: 'dsh-file-viewer', version: '0.2.5', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(sourceDir, 'index.js'), 'new\n')

  await installBundledFileViewerPlugin({ dshHome, sourceDir })

  const plugin = readPluginCatalog({ dshHome }).plugins[0]
  assert.equal(plugin.requested, '0.2.5')
  assert.equal(plugin.source, 'npm')
  assert.equal(plugin.version, '0.2.5')
  assert.equal(existsSync(join(targetDir, 'legacy.js')), false)
  assert.equal(readFileSync(join(targetDir, 'index.js'), 'utf8'), 'new\n')
})

test('upgrades the npm file viewer bundle to the current registry release', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const profileDir = ensureProfileInitialized(dshHome)
  const sourceDir = join(directory, 'app', 'node_modules', 'dsh-file-viewer')
  const targetDir = join(profileDir, 'node_modules', 'dsh-file-viewer')
  const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  profileManifest.dependencies['dsh-file-viewer'] = '0.1.3'
  profileManifest.dsh.profile.bundles.push('dsh-file-viewer')
  writeJson(join(profileDir, 'package.json'), profileManifest)
  writeJson(join(targetDir, 'package.json'), {
    name: 'dsh-file-viewer', version: '0.1.3', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(targetDir, 'legacy.js'), 'old\n')
  writeJson(join(sourceDir, 'package.json'), {
    name: 'dsh-file-viewer', version: '0.2.5', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(sourceDir, 'index.js'), 'new\n')

  await installBundledFileViewerPlugin({ dshHome, sourceDir })

  const plugin = readPluginCatalog({ dshHome }).plugins[0]
  assert.equal(plugin.requested, '0.2.5')
  assert.equal(plugin.source, 'npm')
  assert.equal(plugin.version, '0.2.5')
  assert.equal(plugin.enabled, true)
  assert.equal(existsSync(join(targetDir, 'legacy.js')), false)
  assert.equal(readFileSync(join(targetDir, 'index.js'), 'utf8'), 'new\n')
})

test('upgrades a previous bundled GitHub file viewer release', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const profileDir = ensureProfileInitialized(dshHome)
  const sourceDir = join(directory, 'app', 'node_modules', 'dsh-file-viewer')
  const targetDir = join(profileDir, 'node_modules', 'dsh-file-viewer')
  const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  profileManifest.dependencies['dsh-file-viewer'] = 'github:liguobao/dsh-file-viewer#4295572d3192fd4685aeda42b34a7ddb4b793754'
  profileManifest.dsh.profile.bundles.push('dsh-file-viewer')
  writeJson(join(profileDir, 'package.json'), profileManifest)
  writeJson(join(targetDir, 'package.json'), {
    name: 'dsh-file-viewer', version: '0.2.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(targetDir, 'legacy.js'), 'old\n')
  writeJson(join(sourceDir, 'package.json'), {
    name: 'dsh-file-viewer', version: '0.2.5', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(sourceDir, 'index.js'), 'new\n')

  await installBundledFileViewerPlugin({ dshHome, sourceDir })

  const plugin = readPluginCatalog({ dshHome }).plugins[0]
  assert.equal(plugin.requested, '0.2.5')
  assert.equal(plugin.version, '0.2.5')
  assert.equal(plugin.enabled, true)
  assert.equal(existsSync(join(targetDir, 'legacy.js')), false)
})

test('repairs a bundled file viewer whose ignored prepare script left its dist missing', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const profileDir = ensureProfileInitialized(dshHome)
  const sourceDir = join(directory, 'app', 'node_modules', 'dsh-file-viewer')
  const targetDir = join(profileDir, 'node_modules', 'dsh-file-viewer')
  const releasedSpec = 'github:liguobao/dsh-file-viewer#7fbfc7b8092c6ca1935b19b7563761a5600df522'
  const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  profileManifest.dependencies['dsh-file-viewer'] = releasedSpec
  profileManifest.dsh.profile.bundles.push('dsh-file-viewer')
  writeJson(join(profileDir, 'package.json'), profileManifest)
  writeJson(join(targetDir, 'package.json'), {
    name: 'dsh-file-viewer', version: '0.2.4', main: './dist/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(targetDir, 'cordis.patch.yml'), 'include: []\n')
  writeFileSync(join(targetDir, 'incomplete.js'), 'old\n')
  writeJson(join(sourceDir, 'package.json'), {
    name: 'dsh-file-viewer', version: '0.2.5', main: './dist/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(sourceDir, 'cordis.patch.yml'), 'include: []\n')
  mkdirSync(join(sourceDir, 'dist'), { recursive: true })
  writeFileSync(join(sourceDir, 'dist', 'index.js'), 'built\n')

  await installBundledFileViewerPlugin({ dshHome, sourceDir })

  assert.equal(readFileSync(join(targetDir, 'dist', 'index.js'), 'utf8'), 'built\n')
  assert.equal(existsSync(join(targetDir, 'incomplete.js')), false)
  assert.equal(
    JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies['dsh-file-viewer'],
    '0.2.5',
  )
})

test('upgrades the previous bundled remote release without overwriting online updates', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const profileDir = join(dshHome, 'profiles', 'web')
  const sourceDir = join(directory, 'app', 'node_modules', 'ds-harness-remote')
  ensureProfileInitialized(dshHome)
  const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  profileManifest.dependencies['dsh-remote'] = 'github:liguobao/deepseek-harness-remote#0243b35ba19b506565650322e1d29236c45e7098'
  profileManifest.dsh.profile.bundles.push('dsh-remote')
  writeJson(join(profileDir, 'package.json'), profileManifest)
  writeJson(join(profileDir, 'node_modules', 'dsh-remote', 'package.json'), {
    name: 'dsh-remote', version: '0.3.31', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(profileDir, 'node_modules', 'dsh-remote', 'old.js'), 'broken\n')
  writeJson(join(sourceDir, 'package.json'), {
    name: 'ds-harness-remote', version: '0.3.35', dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(sourceDir, 'fixed.js'), 'fixed\n')

  await installBundledRemotePlugin({ dshHome, sourceDir })

  assert.equal(existsSync(join(profileDir, 'node_modules', 'dsh-remote')), false)
  assert.equal(readFileSync(join(profileDir, 'node_modules', 'ds-harness-remote', 'fixed.js'), 'utf8'), 'fixed\n')
  const plugin = readPluginCatalog({ dshHome }).plugins[0]
  assert.equal(plugin.name, 'ds-harness-remote')
  assert.equal(plugin.requested, '0.3.35')
  assert.equal(plugin.version, '0.3.35')
  const nextManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.equal(nextManifest.dependencies['dsh-remote'], undefined)
  assert.equal(nextManifest.dsh.profile.bundles.includes('dsh-remote'), false)
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
  assert.deepEqual(normalizePluginSpec('github:example/dsh-suite#path:/packages/widget'), {
    spec: 'github:example/dsh-suite#path:/packages/widget',
    source: 'github',
    repository: 'example/dsh-suite',
    path: '/packages/widget',
  })
  assert.deepEqual(normalizePluginSpec('github:example/dsh-suite#v1.2.3&path:/packages/widget'), {
    spec: 'github:example/dsh-suite#v1.2.3&path:/packages/widget',
    source: 'github',
    repository: 'example/dsh-suite',
    ref: 'v1.2.3',
    path: '/packages/widget',
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
  assert.throws(() => normalizePluginSpec('github:example/dsh-suite#path:/packages/../secret'), /Invalid GitHub package path/)
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
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      "@example/github-plugin":\n        specifier: ${JSON.stringify(args.at(-1))}\n        version: https://codeload.github.com/example/dsh-tools/tar.gz/${commit}(@deepseek-ai/cordis@4.0.1)\n`)
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
  assert.deepEqual(calls[0], ['add', '--workspace-root', '--save-prod', '--reporter', 'append-only', '--ignore-scripts', 'github:example/dsh-tools#v2.0.0'])
  assert.ok(calls[1].includes('--allow-build=@example/github-plugin@git+https://github.com/example/dsh-tools.git'))
  assert.equal(calls[1].at(-1), `github:example/dsh-tools#${commit}`)
  assert.equal(catalog.plugins[0].source, 'github')
  assert.equal(catalog.plugins[0].enabled, true)
  assert.equal(catalog.plugins[0].requested, `github:example/dsh-tools#${commit}`)
  assert.ok(Number.isFinite(Date.parse(catalog.plugins[0].installedAt)))
})

test('rejects short GitHub commit hashes before pnpm sees them', async (t) => {
  const dshHome = temporaryDirectory(t)
  let pnpmRan = false
  await assert.rejects(() => installPlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    spec: 'github:example/dsh-tools#8f90abc',
    runPnpmImpl: async () => {
      pnpmRan = true
      return { output: '' }
    },
  }), /full 40-character SHA/)
  assert.equal(pnpmRan, false)
})

test('pins an untagged GitHub subdirectory plugin to the default branch commit', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  const commit = 'abcdef1234567890abcdef1234567890abcdef12'
  writeJson(profileManifest, {
    name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  })
  const gitCalls = []
  const pnpmCalls = []
  const catalog = await installPlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    spec: 'github:example/no-tags#path:/plugins/widget',
    runGitImpl: async ({ args }) => {
      gitCalls.push(args)
      return { output: args.includes('--tags') ? '' : `${commit}\tHEAD\n` }
    },
    runPnpmImpl: async ({ args }) => {
      pnpmCalls.push(args)
      const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
      manifest.dependencies['widget-plugin'] = args.at(-1)
      writeJson(profileManifest, manifest)
      writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      widget-plugin:\n        specifier: ${JSON.stringify(args.at(-1))}\n        version: https://codeload.github.com/example/no-tags/tar.gz/${commit}\n`)
      writeJson(join(profileDir, 'node_modules', 'widget-plugin', 'package.json'), {
        name: 'widget-plugin', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
      })
      return { output: '' }
    },
  })
  assert.equal(gitCalls.length, 2)
  assert.deepEqual(gitCalls[0], ['ls-remote', '--tags', '--refs', '--sort=-version:refname', 'https://github.com/example/no-tags.git'])
  assert.deepEqual(gitCalls[1], ['ls-remote', '--symref', 'https://github.com/example/no-tags.git', 'HEAD'])
  assert.equal(pnpmCalls[0].at(-1), `github:example/no-tags#${commit}&path:/plugins/widget`)
  assert.equal(pnpmCalls[1].at(-1), `github:example/no-tags#${commit}&path:/plugins/widget`)
  assert.equal(catalog.plugins[0].requested, `github:example/no-tags#${commit}&path:/plugins/widget`)
  assert.equal(catalog.plugins[0].enabled, true)
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
  const newName = 'ds-harness-remote'
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
        name: newName, version: '0.3.32', dsh: { bundle: { patch: 'cordis.patch.yml' } },
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
    spec: 'github:liguobao/deepseek-harness-remote#v0.3.32',
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
    dependencies: { '@example/github-plugin': `github:example/dsh-tools#${oldCommit}&path:/plugins/tool` },
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
  assert.equal(pnpmCalls[0].at(-1), `github:example/dsh-tools#${newCommit}&path:/plugins/tool`)
  assert.equal(catalog.upToDate, false)
  assert.equal(catalog.plugins[0].requested, `github:example/dsh-tools#${newCommit}&path:/plugins/tool`)
  assert.equal(catalog.plugins[0].enabled, false)
  assert.equal(catalog.plugins[0].installedAt, undefined)

  const unchanged = await updatePlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    name: '@example/github-plugin',
    runGitImpl,
    runPnpmImpl: async () => assert.fail('pnpm should not run when the plugin is current'),
  })
  assert.equal(unchanged.upToDate, true)
})

test('updates an npm plugin to the latest registry version and preserves its disabled state', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  writeJson(profileManifest, {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { 'dsh-file-viewer': '0.2.4' },
    dsh: { profile: { bundles: [] } },
  })
  writeJson(join(profileDir, 'node_modules', 'dsh-file-viewer', 'package.json'), {
    name: 'dsh-file-viewer', version: '0.2.4', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  })
  const pnpmCalls = []
  const runPnpmImpl = async ({ args }) => {
    pnpmCalls.push(args)
    if (args[0] === 'view') return { output: '0.2.5\n' }
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    manifest.dependencies['dsh-file-viewer'] = '0.2.5'
    writeJson(profileManifest, manifest)
    writeJson(join(profileDir, 'node_modules', 'dsh-file-viewer', 'package.json'), {
      name: 'dsh-file-viewer', version: '0.2.5', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
    return { output: '' }
  }

  const catalog = await updatePlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    name: 'dsh-file-viewer',
    runGitImpl: async () => assert.fail('git should not run for npm updates'),
    runPnpmImpl,
  })
  assert.deepEqual(pnpmCalls, [
    ['view', 'dsh-file-viewer', 'version'],
    ['add', '--workspace-root', '--save-prod', '--reporter', 'append-only', 'dsh-file-viewer@0.2.5'],
  ])
  assert.equal(catalog.upToDate, false)
  assert.equal(catalog.plugins[0].requested, '0.2.5')
  assert.equal(catalog.plugins[0].version, '0.2.5')
  assert.equal(catalog.plugins[0].source, 'npm')
  assert.equal(catalog.plugins[0].enabled, false)

  const unchanged = await updatePlugin({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    name: 'dsh-file-viewer',
    runPnpmImpl: async ({ args }) => {
      assert.deepEqual(args, ['view', 'dsh-file-viewer', 'version'])
      return { output: '0.2.5\n' }
    },
  })
  assert.equal(unchanged.upToDate, true)
})

test('repairs a stale short GitHub ref before updating an installed plugin', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  const newCommit = '2222222222222222222222222222222222222222'
  writeJson(profileManifest, {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { '@example/github-plugin': 'github:example/dsh-tools#1111111&path:/plugins/tool' },
    dsh: { profile: { bundles: ['@example/github-plugin'] } },
  })
  writeJson(join(profileDir, 'node_modules', '@example', 'github-plugin', 'package.json'), {
    name: '@example/github-plugin', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  })
  const pnpmCalls = []
  const runPnpmImpl = async ({ args }) => {
    pnpmCalls.push(args)
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    assert.equal(manifest.dependencies['@example/github-plugin'], `github:example/dsh-tools#${newCommit}&path:/plugins/tool`)
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
    runGitImpl: async () => ({ output: `ref: refs/heads/main\tHEAD\n${newCommit}\tHEAD\n` }),
    runPnpmImpl,
  })
  assert.equal(pnpmCalls[0].at(-1), `github:example/dsh-tools#${newCommit}&path:/plugins/tool`)
  assert.equal(catalog.plugins[0].requested, `github:example/dsh-tools#${newCommit}&path:/plugins/tool`)
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

test('initializes a fresh profile with system bundles without overwriting user files', (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')

  ensureProfileInitialized(dshHome)
  const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
  assert.equal(manifest.name, 'dsh-profile-web')
  assert.equal(manifest.private, true)
  assert.deepEqual(manifest.dependencies, {})
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  assert.match(readFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'utf8'), /nodeLinker: hoisted/)

  // A user-owned manifest is left untouched.
  const custom = { name: 'custom', dependencies: { '@example/plugin': '1.0.0' }, dsh: { profile: { bundles: ['@example/plugin'] } } }
  writeJson(profileManifest, custom)
  ensureProfileInitialized(dshHome)
  assert.deepEqual(JSON.parse(readFileSync(profileManifest, 'utf8')), custom)
})

test('installs a bundled default GitHub plugin once and records the marker', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  const commit = '1234567890abcdef1234567890abcdef12345678'
  writeJson(profileManifest, {
    name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  })
  const pnpmCalls = []
  const runPnpmImpl = async ({ args }) => {
    pnpmCalls.push(args)
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
    manifest.dependencies['ds-harness-remote'] = args.at(-1)
    writeJson(profileManifest, manifest)
    writeJson(join(profileDir, 'node_modules', 'ds-harness-remote', 'package.json'), {
      name: 'ds-harness-remote', version: '0.3.32', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      ds-harness-remote:\n        specifier: ${JSON.stringify(args.at(-1))}\n        version: https://codeload.github.com/liguobao/deepseek-harness-remote/tar.gz/${commit}\n`)
    return { output: '' }
  }
  const options = {
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    defaults: ['github:liguobao/deepseek-harness-remote#v0.3.32'],
    runPnpmImpl,
  }

  const first = await ensureDefaultPlugins(options)
  assert.deepEqual(first.installed, ['github:liguobao/deepseek-harness-remote'])
  assert.equal(pnpmCalls.length, 2)
  assert.equal(first.plugins[0].name, 'ds-harness-remote')
  assert.equal(first.plugins[0].source, 'github')
  assert.equal(first.plugins[0].enabled, true)

  const second = await ensureDefaultPlugins(options)
  assert.deepEqual(second.installed, [])
  assert.equal(pnpmCalls.length, 2)
})

test('keeps a removed default plugin from returning on the next launch', async (t) => {
  const dshHome = temporaryDirectory(t)
  const profileDir = join(dshHome, 'profiles', 'web')
  const profileManifest = join(profileDir, 'package.json')
  writeJson(profileManifest, {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { 'ds-harness-remote': 'github:liguobao/deepseek-harness-remote#v0.3.32' },
    dsh: { profile: { bundles: ['ds-harness-remote'] } },
  })
  writeJson(join(profileDir, 'node_modules', 'ds-harness-remote', 'package.json'), {
    name: 'ds-harness-remote', version: '0.3.32', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  })
  writeJson(join(profileDir, '.dsh-desktop-default-plugins.json'), {
    version: 1, seen: ['github:liguobao/deepseek-harness-remote'],
  })

  // The user uninstalls the default plugin.
  const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
  delete manifest.dependencies['ds-harness-remote']
  manifest.dsh.profile.bundles = []
  writeJson(profileManifest, manifest)

  const result = await ensureDefaultPlugins({
    dshHome,
    pnpmEntry: '/pnpm.mjs',
    defaults: ['github:liguobao/deepseek-harness-remote#v0.3.32'],
    runPnpmImpl: async () => assert.fail('pnpm should not run for a seen default'),
  })
  assert.deepEqual(result.installed, [])
  assert.deepEqual(result.plugins, [])
})

test('limits plugin IPC to the local plugin page and fixed operations', () => {
  const main = readFileSync(mainUrl, 'utf8')
  const service = readFileSync(serviceUrl, 'utf8')
  const preload = readFileSync(preloadUrl, 'utf8')
  const page = readFileSync(pageUrl, 'utf8')
  assert.match(main, /senderIsPluginManager\(event\)/)
  assert.match(main, /pagePath\('plugins\.html'\)/)
  assert.match(main, /plugins: '插件'/)
  assert.match(main, /label: copy\.plugins,[\s\S]*submenu: \[[\s\S]*\{ label: copy\.pluginManager, click: showPluginManager \}/)
  assert.doesNotMatch(main, /senderIsExtensionManager|extensions\.html|dsh-desktop:skills-/)
  assert.match(main, /dsh-desktop:plugins-update/)
  assert.match(main, /installProfilePlugin\(\{[\s\S]*?env: harnessEnv,[\s\S]*?spec,/)
  assert.match(main, /updateProfilePlugin\(\{[\s\S]*?env: harnessEnv,[\s\S]*?name,/)
  assert.match(main, /removeProfilePlugin\(\{[\s\S]*?env: harnessEnv,[\s\S]*?name,/)
  assert.match(main, /dsh-desktop:plugins-discover/)
  assert.match(main, /normalizePluginSourceUrl\(url\)/)
  assert.match(service, /shell: false/)
  assert.match(preload, /dsh-desktop:plugins-install/)
  assert.match(preload, /dsh-desktop:plugins-update/)
  assert.match(preload, /dsh-desktop:plugins-discover/)
  assert.match(preload, /dsh-desktop:plugins-source/)
  assert.match(preload, /dsh-desktop:plugins-enabled/)
  assert.match(preload, /dsh-desktop:plugins-remove/)
  assert.doesNotMatch(preload, /dsh-desktop:skills-/)
  assert.doesNotMatch(preload, /child_process|exec\(|spawn\(/)
  assert.doesNotMatch(page, /\.innerHTML\s*=/)
})
