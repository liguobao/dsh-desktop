import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { loadingStateScript, normalizeProgress } from '../src/startup-progress.js'

test('normalizes startup progress to an integer percentage', () => {
  assert.equal(normalizeProgress(-4), 0)
  assert.equal(normalizeProgress(47.6), 48)
  assert.equal(normalizeProgress(140), 100)
  assert.equal(normalizeProgress('not-a-number'), 0)
})

test('serializes startup state as data when evaluated', () => {
  const script = loadingStateScript('</script><script>alert(1)</script>', 42)
  let received
  runInNewContext(script, {
    window: {
      setStartupState(state) { received = state },
    },
  })
  assert.equal(received.message, '</script><script>alert(1)</script>')
  assert.equal(received.progress, 42)
})

test('default plugin installation runs only after Harness startup completes', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const readyHandler = source.slice(source.indexOf('app.whenReady().then'))
  const start = readyHandler.indexOf('startHarness().then')
  const install = readyHandler.indexOf('if (started) void installDefaultPlugins()')

  assert.ok(start >= 0)
  assert.ok(install > start)
  assert.doesNotMatch(readyHandler.slice(0, start), /await installDefaultPlugins\(\)/)
})

test('bundled plugins are prepared locally after the splash appears and before Harness starts', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const readyHandler = source.slice(source.indexOf('app.whenReady().then'))
  const splash = readyHandler.indexOf('await showLoading(copy.preparing')
  const remote = readyHandler.indexOf('await installBundledRemotePlugin')
  const fileViewer = readyHandler.indexOf('await installBundledFileViewerPlugin')
  const start = readyHandler.indexOf('startHarness().then')

  assert.ok(splash >= 0)
  assert.ok(remote > splash)
  assert.ok(fileViewer > remote)
  assert.ok(start > fileViewer)
  assert.doesNotMatch(readyHandler, /installBundledCodexSubagentPlugin/)
})

test('DSH always launches from the app bundle without an independent updater', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')

  assert.match(source, /entry: resolveDshEntry\(\)/)
  assert.match(source, /Using bundled DSH/)
  assert.doesNotMatch(source, /createDshUpdateController|dshUpdateController|activeDshRuntime|DSH_RUNTIME_DIRECTORY/)
})
