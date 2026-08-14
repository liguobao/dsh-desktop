import assert from 'node:assert/strict'
import test from 'node:test'
import { isExternalHttpUrl, isHarnessUrl } from '../src/navigation.js'

test('accepts only the exact loopback Harness origin', () => {
  const origin = 'http://127.0.0.1:32123'
  assert.equal(isHarnessUrl(`${origin}/settings`, origin), true)
  assert.equal(isHarnessUrl('http://127.0.0.1:32124/', origin), false)
  assert.equal(isHarnessUrl('http://example.com/', origin), false)
  assert.equal(isHarnessUrl('file:///tmp/index.html', origin), false)
  assert.equal(isHarnessUrl('not a url', origin), false)
})

test('opens only HTTP(S) links externally', () => {
  assert.equal(isExternalHttpUrl('https://deepseek.com/'), true)
  assert.equal(isExternalHttpUrl('http://example.com/'), true)
  assert.equal(isExternalHttpUrl('file:///etc/passwd'), false)
  assert.equal(isExternalHttpUrl('javascript:alert(1)'), false)
})
