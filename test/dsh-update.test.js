import assert from 'node:assert/strict'
import test from 'node:test'
import { createDshUpdateController } from '../src/dsh-update.js'

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve))
}

function fixture({ responses = [], checkImpl, installImpl } = {}) {
  const bundled = { source: 'bundled', version: '1.0.0', entry: '/bundled/bin.js' }
  const messages = []
  const changed = []
  let deactivated = 0
  const queue = [...responses]
  const controller = createDshUpdateController({
    initialRuntime: { ...bundled, bundled },
    runtimeRoot: '/runtime',
    pnpmEntry: '/pnpm.mjs',
    isChinese: false,
    dialog: {
      async showMessageBox(options) {
        messages.push(options)
        return { response: queue.shift() ?? 1 }
      },
    },
    getWindow: () => undefined,
    onRuntimeChanged: async runtime => { changed.push(runtime) },
    checkImpl: checkImpl ?? (async () => ({ currentVersion: '1.0.0', latestVersion: '1.0.0', available: false })),
    installImpl: installImpl ?? (async ({ version }) => ({
      source: 'managed',
      version,
      entry: `/runtime/${version}/bin.js`,
    })),
    deactivateImpl: () => { deactivated += 1 },
  })
  return { bundled, changed, controller, deactivated: () => deactivated, messages }
}

test('manual DSH check reports the running npm version is current', async () => {
  const { controller, messages } = fixture()

  await controller.check(true)

  assert.equal(controller.state, 'idle')
  assert.equal(messages.at(-1).title, 'DSH Is Up to Date')
})

test('available DSH version installs in user data and restarts Harness after confirmation', async () => {
  const { changed, controller, messages } = fixture({
    responses: [0],
    checkImpl: async () => ({ currentVersion: '1.0.0', latestVersion: '1.1.0', available: true }),
  })

  await controller.check(false)

  assert.equal(messages[0].title, 'DSH Update Available')
  assert.equal(changed.length, 1)
  assert.equal(changed[0].source, 'managed')
  assert.equal(changed[0].version, '1.1.0')
  assert.equal(controller.runtime.version, '1.1.0')
  assert.equal(controller.state, 'idle')
  assert.match(controller.restoreItem().label, /Restore Bundled DSH 1\.0\.0/)
})

test('managed DSH can be restored to the bundled version', async () => {
  const setup = fixture({
    responses: [0, 0],
    checkImpl: async () => ({ currentVersion: '1.0.0', latestVersion: '1.1.0', available: true }),
  })
  await setup.controller.check(true)
  await nextTurn()

  await setup.controller.restoreBundled()

  assert.equal(setup.deactivated(), 1)
  assert.equal(setup.controller.runtime.source, 'bundled')
  assert.equal(setup.changed.at(-1).version, '1.0.0')
  assert.equal(setup.controller.restoreItem(), undefined)
})

test('failed managed runtime can be deactivated without another prompt', async () => {
  const setup = fixture({
    responses: [0],
    checkImpl: async () => ({ currentVersion: '1.0.0', latestVersion: '1.1.0', available: true }),
  })
  await setup.controller.check(true)

  assert.equal(setup.controller.useBundledFallback(), true)
  assert.equal(setup.controller.useBundledFallback(), false)
  assert.equal(setup.deactivated(), 1)
  assert.equal(setup.controller.runtime.source, 'bundled')
})
