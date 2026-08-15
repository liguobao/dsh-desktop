import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

test('loads the online catalog and falls back to the bundled snapshot', async (t) => {
  const bundledPath = temporaryCatalog(t)
  const online = await loadPluginCatalog({
    bundledPath,
    fetchImpl: async () => new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  })
  assert.equal(online.online, true)
  assert.equal(online.catalog.count, 2)

  const offline = await loadPluginCatalog({
    bundledPath,
    fetchImpl: async () => { throw new Error('offline') },
  })
  assert.equal(offline.online, false)
  assert.equal(offline.error, 'offline')
  assert.equal(offline.catalog.count, 2)
})

test('bundled catalog is populated and source links stay on GitHub', () => {
  const catalog = readBundledPluginCatalog()
  assert.ok(catalog.count >= 400)
  assert.equal(catalog.count, catalog.plugins.length)
  assert.equal(normalizePluginSourceUrl('https://github.com/example/plugin/tree/main'), 'https://github.com/example/plugin/tree/main')
  assert.throws(() => normalizePluginSourceUrl('https://example.com/example/plugin'), /GitHub repositories/)
  assert.throws(() => normalizePluginSourceUrl('javascript:alert(1)'), /GitHub repositories/)
})
