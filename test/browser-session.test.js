import assert from 'node:assert/strict'
import test from 'node:test'

import { pruneHarnessSessionCookies, pruneStaleAuthCookies, selectStaleAuthCookies } from '../src/browser-session.js'

const EXPIRES = 1_790_000_000

const auth = (name, expirationDate = EXPIRES, domain = '127.0.0.1') => ({ name, domain, expirationDate, path: '/' })

test('the newest auth cookie per loopback host survives', () => {
  const stale = selectStaleAuthCookies([
    auth('dsh-auth-oldest', EXPIRES - 300),
    auth('dsh-auth-newest', EXPIRES),
    auth('dsh-auth-middle', EXPIRES - 100),
  ])

  assert.deepEqual(stale.map((entry) => entry.name).sort(), ['dsh-auth-middle', 'dsh-auth-oldest'])
})

test('each loopback spelling keeps its own newest cookie', () => {
  const stale = selectStaleAuthCookies([
    auth('dsh-auth-ip-current', EXPIRES, '127.0.0.1'),
    auth('dsh-auth-ip-old', EXPIRES - 10, '127.0.0.1'),
    auth('dsh-auth-localhost-current', EXPIRES, 'localhost'),
    auth('dsh-auth-localhost-old', EXPIRES - 10, 'localhost'),
  ])

  assert.deepEqual(stale.map((entry) => entry.name).sort(), ['dsh-auth-ip-old', 'dsh-auth-localhost-old'])
})

test('unrelated cookies and other hosts are never touched', () => {
  const stale = selectStaleAuthCookies([
    auth('dsh-auth-keep', EXPIRES),
    auth('dsh-auth-other-host', EXPIRES - 10, 'example.com'),
    auth('some-other-cookie', EXPIRES - 10),
    { name: 'dsh-auth-no-expiry' },
    { name: 42, domain: '127.0.0.1' },
    null,
  ])

  assert.deepEqual(stale, [])
})

test('a leading dot on the domain still matches loopback', () => {
  const stale = selectStaleAuthCookies([
    auth('dsh-auth-current', EXPIRES, '.127.0.0.1'),
    auth('dsh-auth-old', EXPIRES - 10, '.127.0.0.1'),
  ])

  assert.deepEqual(stale.map((entry) => entry.name), ['dsh-auth-old'])
})

test('pruning removes only the stale cookies and reports how many', async () => {
  const removed = []
  const store = {
    'http://127.0.0.1/': [auth('dsh-auth-a', EXPIRES - 20), auth('dsh-auth-b', EXPIRES)],
    'http://localhost/': [auth('dsh-auth-c', EXPIRES)],
  }

  const count = await pruneStaleAuthCookies({
    cookiesForHost: async (url) => store[url] ?? [],
    removeCookie: async (url, name) => removed.push(`${url} ${name}`),
  })

  assert.equal(count, 1)
  assert.deepEqual(removed, ['http://127.0.0.1/ dsh-auth-a'])
})

test('a failing cookie store never breaks the boot', async () => {
  const count = await pruneStaleAuthCookies({
    cookiesForHost: async () => {
      throw new Error('store unavailable')
    },
    removeCookie: async () => {},
  })

  assert.equal(count, 0)
})

test('a removal failure is contained', async () => {
  const count = await pruneStaleAuthCookies({
    cookiesForHost: async () => [auth('dsh-auth-a', EXPIRES - 20), auth('dsh-auth-b', EXPIRES)],
    removeCookie: async () => {
      throw new Error('locked')
    },
  })

  assert.equal(count, 0)
})

test('a hanging cookie store is bounded and logged', async () => {
  const messages = []
  const count = await pruneStaleAuthCookies({
    cookiesForHost: () => new Promise(() => {}),
    removeCookie: async () => {},
    log: (message) => messages.push(message),
    timeoutMs: 20,
  })

  assert.equal(count, 0)
  assert.equal(messages.length, 1)
  assert.match(messages[0], /timed out/)
})

test('a successful cleanup is logged once, a no-op is silent', async () => {
  const messages = []
  await pruneStaleAuthCookies({
    cookiesForHost: async (url) => (url === 'http://127.0.0.1/'
      ? [auth('dsh-auth-a', EXPIRES - 20), auth('dsh-auth-b', EXPIRES)]
      : []),
    removeCookie: async () => {},
    log: (message) => messages.push(message),
  })
  assert.equal(messages.length, 1)
  assert.match(messages[0], /Removed 1 stale Harness session cookie/)

  const quiet = []
  await pruneStaleAuthCookies({
    cookiesForHost: async (url) => (url === 'http://127.0.0.1/' ? [auth('dsh-auth-a', EXPIRES)] : []),
    removeCookie: async () => {},
    log: (message) => quiet.push(message),
  })
  assert.deepEqual(quiet, [])
})

test('the Electron wrapper drives the session cookie API', async () => {
  const removed = []
  const session = {
    cookies: {
      get: async ({ url }) => (url === 'http://127.0.0.1/'
        ? [auth('dsh-auth-old', EXPIRES - 10), auth('dsh-auth-new', EXPIRES)]
        : []),
      remove: async (url, name) => removed.push(`${url} ${name}`),
    },
  }

  assert.equal(await pruneHarnessSessionCookies(session), 1)
  assert.deepEqual(removed, ['http://127.0.0.1/ dsh-auth-old'])
})

test('a session without cookie support is a silent no-op', async () => {
  assert.equal(await pruneHarnessSessionCookies({}), 0)
  assert.equal(await pruneHarnessSessionCookies(undefined), 0)
})
