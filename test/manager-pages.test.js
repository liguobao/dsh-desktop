import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('plugin and extension managers use separate pages and bridges', () => {
  const pluginPage = source('../src/pages/plugins.html')
  const extensionPage = source('../src/pages/extensions.html')
  const pluginPreload = source('../src/plugin-preload.cjs')
  const extensionPreload = source('../src/extension-preload.cjs')

  assert.match(pluginPage, /plugins-page\.js/)
  assert.doesNotMatch(pluginPage, /extensions-page\.js|role="tablist"/)
  assert.match(extensionPage, /extensions-page\.js/)
  assert.doesNotMatch(extensionPage, /plugins-page\.js|role="tablist"/)

  assert.match(pluginPreload, /dshPluginManager/)
  assert.match(pluginPreload, /dsh-desktop:plugins-list/)
  assert.doesNotMatch(pluginPreload, /dsh-desktop:skills-/)
  assert.match(extensionPreload, /dshExtensionManager/)
  assert.match(extensionPreload, /dsh-desktop:skills-list/)
  assert.doesNotMatch(extensionPreload, /dsh-desktop:plugins-/)
})

test('manager pages disallow inline scripts and styles', () => {
  for (const page of [source('../src/pages/plugins.html'), source('../src/pages/extensions.html')]) {
    assert.match(page, /style-src 'self'; script-src 'self'/)
    assert.doesNotMatch(page, /unsafe-inline/)
  }
})
