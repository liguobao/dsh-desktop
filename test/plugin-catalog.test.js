import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadPluginCatalog,
  normalizePluginCatalog,
  normalizePluginSourceUrl,
  readBundledPluginCatalog,
} from '../src/plugin-catalog.js'

const fixture = {
  source: 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
  updated: '2026-08-15',
  categories: { ui: { en: 'UI Enhancements', zh: 'UI 增强' } },
  plugins: [
    {
      name: 'example-plugin',
      owner: 'example',
      url: 'https://github.com/example/plugin',
      category: 'ui',
      description: { en: 'Example plugin', zh: '示例插件' },
      npm: '@example/plugin',
      stars: 12,
    },
    {
      name: 'suite#widget',
      owner: 'example',
      url: 'https://github.com/example/suite/tree/main/packages/widget',
      category: 'ui',
      description: { en: 'Widget', zh: '组件' },
      install: 'dsh plugin --profile web add github:example/suite#path:/packages/widget',
    },
    {
      name: 'unsafe',
      url: 'https://example.com/unsafe',
      npm: '../unsafe',
    },
    {
      name: 'mismatched',
      url: 'https://github.com/example/safe',
      install: 'dsh plugin --profile web add github:example/other',
    },
  ],
}

function temporaryCatalog(t, value = fixture) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-plugin-catalog-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'catalog.json')
  writeFileSync(path, `${JSON.stringify(value)}\n`)
  return path
}

function temporaryExtra(t, plugins) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-plugin-extra-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'extra.json')
  writeFileSync(path, `${JSON.stringify({ plugins })}\n`)
  return path
}

test('normalizes only safe npm and GitHub plugin catalog entries', () => {
  const catalog = normalizePluginCatalog(fixture, { generatedAt: '2026-08-15T00:00:00.000Z' })
  assert.equal(catalog.count, 2)
  assert.equal(catalog.plugins[0].spec, '@example/plugin')
  assert.equal(catalog.plugins[0].repository, 'example/plugin')
  assert.equal(catalog.plugins[1].spec, 'github:example/suite#path:/packages/widget')
  assert.equal(catalog.plugins[1].path, '/packages/widget')
  assert.equal(catalog.categories.ui.zh, 'UI 增强')
  assert.equal(catalog.generatedAt, '2026-08-15T00:00:00.000Z')
})

test('loads the online catalog, merges local extras, and falls back to the bundled snapshot', async (t) => {
  const bundledPath = temporaryCatalog(t)
  const extraPath = temporaryExtra(t, [
    {
      name: 'local-remote',
      owner: 'example',
      url: 'https://github.com/example/remote',
      category: 'tools',
      description: { en: 'Local remote', zh: '本地远程' },
      install: 'dsh plugin --profile web add github:example/remote',
      added: '2026-08-16',
    },
  ])
  const online = await loadPluginCatalog({
    bundledPath,
    extraPath,
    fetchImpl: async () => new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  })
  assert.equal(online.online, true)
  assert.equal(online.local, 1)
  assert.equal(online.catalog.count, 3)
  assert.ok(online.catalog.plugins.some((plugin) => plugin.repository === 'example/remote'))

  const offline = await loadPluginCatalog({
    bundledPath,
    extraPath,
    fetchImpl: async () => { throw new Error('offline') },
  })
  assert.equal(offline.online, false)
  assert.equal(offline.error, 'offline')
  assert.equal(offline.catalog.count, 3)
  assert.ok(offline.catalog.plugins.some((plugin) => plugin.repository === 'example/remote'))
})

test('merges the bundled local extra entries into the online catalog at runtime', async (t) => {
  const extra = JSON.parse(readFileSync(new URL('../src/plugin-catalog.extra.json', import.meta.url), 'utf8'))
  assert.ok(Array.isArray(extra.plugins), 'extra entries should be an array of registry-style entries')
  const online = await loadPluginCatalog({
    bundledPath: temporaryCatalog(t),
    fetchImpl: async () => new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  })
  assert.equal(online.online, true)
  assert.equal(online.local, extra.plugins.length)
  for (const entry of extra.plugins) {
    const url = new URL(entry.url)
    const repository = url.pathname.split('/').filter(Boolean).slice(0, 2).join('/')
    const plugin = online.catalog.plugins.find((candidate) => candidate.repository.toLowerCase() === repository.toLowerCase())
    assert.ok(plugin, `online catalog should contain merged local extra entry ${repository}`)
    assert.equal(plugin.source, entry.npm === undefined ? 'github' : 'npm')
  }
})

test('does not duplicate local extra entries already listed in the online catalog', async (t) => {
  const bundledPath = temporaryCatalog(t)
  const extraPath = temporaryExtra(t, [
    fixture.plugins[0], // npm @example/plugin is already listed online
    {
      name: 'new-tool',
      owner: 'example',
      url: 'https://github.com/example/new-tool',
      category: 'tools',
      description: 'A brand new tool',
      install: 'dsh plugin --profile web add github:example/new-tool',
    },
  ])
  const online = await loadPluginCatalog({
    bundledPath,
    extraPath,
    fetchImpl: async () => new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  })
  assert.equal(online.online, true)
  assert.equal(online.local, 2)
  assert.equal(online.catalog.count, 3)
  assert.equal(online.catalog.plugins.filter((plugin) => plugin.npm === '@example/plugin').length, 1)
  assert.ok(online.catalog.plugins.some((plugin) => plugin.repository === 'example/new-tool'))
})

test('bundled catalog is populated and source links stay on GitHub', () => {
  const catalog = readBundledPluginCatalog()
  assert.ok(catalog.count >= 400)
  assert.equal(catalog.count, catalog.plugins.length)
  assert.equal(normalizePluginSourceUrl('https://github.com/example/plugin/tree/main'), 'https://github.com/example/plugin/tree/main')
  assert.throws(() => normalizePluginSourceUrl('https://example.com/example/plugin'), /GitHub repositories/)
  assert.throws(() => normalizePluginSourceUrl('javascript:alert(1)'), /GitHub repositories/)
})

test('bundled catalog carries the local extra entries', () => {
  const extra = JSON.parse(readFileSync(new URL('../src/plugin-catalog.extra.json', import.meta.url), 'utf8'))
  assert.ok(Array.isArray(extra.plugins), 'extra entries should be an array of registry-style entries')
  const catalog = readBundledPluginCatalog()
  for (const entry of extra.plugins) {
    const url = new URL(entry.url)
    const repository = url.pathname.split('/').filter(Boolean).slice(0, 2).join('/')
    const plugin = catalog.plugins.find((p) => p.repository.toLowerCase() === repository.toLowerCase())
    assert.ok(plugin, `bundled catalog should contain local extra entry ${repository}`)
    assert.equal(plugin.source, entry.npm === undefined ? 'github' : 'npm')
  }
})
