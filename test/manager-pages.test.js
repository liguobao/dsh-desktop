import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('plugin manager uses a single page and bridge without tabs or Skills', () => {
  const pluginPage = source('../src/pages/plugins.html')
  const pluginScript = source('../src/pages/plugins-page.js')
  const pluginPreload = source('../src/plugin-preload.cjs')

  assert.match(pluginPage, /plugins-page\.js/)
  assert.doesNotMatch(pluginPage, /extensions-page\.js|role="tablist"/)
  assert.doesNotMatch(pluginPage, /id="page-title"|id="plugin-trust"/)

  assert.match(pluginPreload, /dshPluginManager/)
  assert.match(pluginPreload, /dsh-desktop:plugins-list/)
  assert.match(pluginPreload, /dsh-desktop:plugins-discover/)
  assert.match(pluginPreload, /dsh-desktop:plugins-source/)
  assert.match(pluginPage, /id="plugin-search"/)
  assert.match(pluginPage, /id="open-catalog"/)
  assert.match(pluginPage, /id="open-installed"/)
  assert.match(pluginPage, /id="catalog-pagination"/)
  assert.match(pluginPage, /id="plugin-preview-list"/)
  assert.match(pluginPage, /id="online-preview-list"/)
  assert.match(pluginPage, /id="installed-view"[^>]*hidden/)
  assert.match(pluginPage, /id="catalog-view"[^>]*hidden/)
  assert.match(pluginScript, /slice\(0, 3\)/)
  assert.match(pluginScript, /function randomDiscoveryPreview\(\)/)
  assert.match(pluginScript, /discoveryPreview = randomDiscoveryPreview\(\)/)
  assert.match(pluginScript, /const CATALOG_PAGE_SIZE = 5/)
  assert.match(pluginScript, /pagePlugins = matches\.slice/)
  assert.match(pluginScript, /addedTime\(right\) - addedTime\(left\)/)
  assert.doesNotMatch(pluginPreload, /dsh-desktop:skills-/)
})

test('manual plugin installation opens in a native dialog', () => {
  const page = source('../src/pages/plugins.html')
  const script = source('../src/pages/plugins-page.js')
  const topActions = /<div class="top-actions">([\s\S]*?)<\/div>/.exec(page)?.[1] ?? ''

  assert.match(page, /id="open-install"[^>]*aria-haspopup="dialog"[^>]*aria-controls="install-dialog"/)
  assert.doesNotMatch(topActions, /id="open-install"/)
  assert.match(page, /id="open-installed"[^>]*>[\s\S]*?id="installed-heading-label"[\s\S]*?id="installed-count"/)
  assert.match(page, /id="open-catalog"[^>]*>[\s\S]*?id="online-heading-label"[\s\S]*?id="online-count"/)
  assert.match(page, /<div class="section-actions">[\s\S]*?id="open-install"/)
  assert.doesNotMatch(page, /class="more-button" id="open-(?:installed|catalog)"/)
  assert.doesNotMatch(page, /id="installed-path"/)
  assert.match(page, /<dialog[^>]*id="install-dialog"[\s\S]*<form[^>]*id="plugin-install-form"/)
  assert.match(page, /id="plugin-spec"/)
  assert.match(page, /id="plugin-install"[^>]*type="submit"/)
  assert.match(script, /elements\.installDialog\.showModal\(\)/)
  assert.match(script, /api\.install\(spec, allowBuildScripts\)/)
})

test('manager pages disallow inline scripts and styles', () => {
  const page = source('../src/pages/plugins.html')
  assert.match(page, /style-src 'self'; script-src 'self'/)
  assert.doesNotMatch(page, /unsafe-inline/)
})

test('about page shows bundled component versions and the project GitHub address', () => {
  const page = source('../src/pages/about.html')
  const script = source('../src/pages/about-page.js')
  const main = source('../src/main.js')

  assert.match(page, /id="desktop-version"/)
  assert.match(page, /id="dsh-version"/)
  assert.match(page, /id="remote-version"/)
  assert.match(page, /id="file-viewer-version"/)
  assert.match(page, /id="codex-subagent-version"/)
  assert.match(page, /https:\/\/github\.com\/liguobao\/dsh-desktop/)
  assert.match(page, /style-src 'self'; script-src 'self'/)
  assert.doesNotMatch(page, /unsafe-inline/)
  assert.match(script, /version\('desktop'\)/)
  assert.match(script, /version\('dsh'\)/)
  assert.match(main, /desktop: app\.getVersion\(\)/)
  assert.match(main, /bundledPackageVersion\('@deepseek-ai\/dsh'\)/)
  assert.match(main, /bundledPackageVersion\('dsh-remote'\)/)
  assert.match(main, /bundledPackageVersion\('dsh-file-viewer'\)/)
  assert.match(main, /bundledPackageVersion\('@deepseek-ai\/dsh-subagent-codex'\)/)
  assert.match(main, /label: copy\.about, click: showAbout/)
})
