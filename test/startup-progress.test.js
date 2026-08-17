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
  const bundled = readyHandler.indexOf('await installBundledRemotePlugin')
  const start = readyHandler.indexOf('startHarness().then')

  assert.ok(splash >= 0)
  assert.ok(bundled > splash)
  assert.ok(start > bundled)
})
