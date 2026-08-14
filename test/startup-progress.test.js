import assert from 'node:assert/strict'
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
