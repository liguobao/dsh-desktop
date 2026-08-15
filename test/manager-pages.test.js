import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('plugin manager uses a single page and bridge without tabs or Skills', () => {
  const pluginPage = source('../src/pages/plugins.html')
  const pluginPreload = source('../src/plugin-preload.cjs')

  assert.match(pluginPage, /plugins-page\.js/)
  assert.doesNotMatch(pluginPage, /extensions-page\.js|role="tablist"/)

  assert.match(pluginPreload, /dshPluginManager/)
  assert.match(pluginPreload, /dsh-desktop:plugins-list/)
  assert.match(pluginPreload, /dsh-desktop:plugins-discover/)
  assert.match(pluginPreload, /dsh-desktop:plugins-source/)
  assert.match(pluginPage, /id="plugin-search"/)
  assert.match(pluginPage, /id="open-catalog"/)
  assert.match(pluginPage, /id="catalog-view"[^>]*hidden/)
  assert.doesNotMatch(pluginPreload, /dsh-desktop:skills-/)
})

test('manager pages disallow inline scripts and styles', () => {
  const page = source('../src/pages/plugins.html')
  assert.match(page, /style-src 'self'; script-src 'self'/)
  assert.doesNotMatch(page, /unsafe-inline/)
})
