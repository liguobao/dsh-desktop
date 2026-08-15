import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  RELEASES_URL,
  createAutoUpdateController,
  supportsAutomaticUpdates,
} from '../src/auto-update.js'

class FakeUpdater extends EventEmitter {
  checkCount = 0
  downloadCount = 0
  installCalls = []

  async checkForUpdates() {
    this.checkCount += 1
  }

  async downloadUpdate() {
    this.downloadCount += 1
  }

  quitAndInstall(...args) {
    this.installCalls.push(args)
  }
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve))
}

function fixture(overrides = {}) {
  const updater = new FakeUpdater()
  const messages = []
  const responses = [...(overrides.responses ?? [])]
  const opened = []
  let prepared = 0
  const controller = createAutoUpdateController({
    updater,
    isPackaged: true,
    platform: 'linux',
    env: { APPIMAGE: '/opt/DSH-Desktop.AppImage' },
    isChinese: false,
    currentVersion: '1.0.0',
    dialog: {
      async showMessageBox(options) {
        messages.push(options)
        return { response: responses.shift() ?? 1 }
      },
    },
    getWindow: () => undefined,
    openReleasePage: async url => { opened.push(url) },
    beforeQuitAndInstall: async () => { prepared += 1 },
    ...overrides,
  })
  return { controller, messages, opened, updater, prepared: () => prepared }
}

test('automatic updates are limited to installable packaged formats', () => {
  assert.equal(supportsAutomaticUpdates({ isPackaged: true, platform: 'darwin' }), true)
  assert.equal(supportsAutomaticUpdates({ isPackaged: true, platform: 'linux', env: { APPIMAGE: '/app' } }), true)
  assert.equal(supportsAutomaticUpdates({ isPackaged: true, platform: 'linux', env: {} }), false)
  assert.equal(supportsAutomaticUpdates({
    isPackaged: true,
    platform: 'win32',
    env: { PORTABLE_EXECUTABLE_FILE: 'DSH-Desktop.exe' },
  }), false)
  assert.equal(supportsAutomaticUpdates({ isPackaged: false, platform: 'win32' }), false)
})

test('unsupported packages open the latest GitHub release from the menu', async () => {
  const { controller, opened, updater } = fixture({ isPackaged: false })

  assert.equal(controller.initialize(), false)
  assert.equal(controller.menuItem().label, 'View Latest Release…')
  await controller.check(true)

  assert.deepEqual(opened, [RELEASES_URL])
  assert.equal(updater.checkCount, 0)
})

test('a manual check reports when the installed version is current', async () => {
  const { controller, messages, updater } = fixture()
  assert.equal(controller.initialize(), true)

  await controller.check(true)
  updater.emit('update-not-available', { version: '1.0.0' })
  await nextTurn()

  assert.equal(updater.checkCount, 1)
  assert.equal(controller.state, 'idle')
  assert.equal(messages.at(-1).title, 'You’re Up to Date')
})

test('an available update downloads and installs after user confirmation', async () => {
  const { controller, messages, prepared, updater } = fixture({ responses: [0, 0] })
  controller.initialize()

  await controller.check(false)
  updater.emit('update-available', { version: '1.1.0' })
  await nextTurn()

  assert.equal(updater.downloadCount, 1)
  assert.equal(controller.state, 'downloading')
  updater.emit('download-progress', { percent: 42.4 })
  assert.equal(controller.menuItem().label, 'Downloading Update… 42%')

  updater.emit('update-downloaded', { version: '1.1.0' })
  await nextTurn()

  assert.equal(messages.length, 2)
  assert.equal(prepared(), 1)
  assert.deepEqual(updater.installCalls, [[false, true]])
  assert.equal(controller.state, 'installing')
})

test('background check errors are logged without interrupting the user', async () => {
  const logs = []
  const { controller, messages, updater } = fixture({ log: (level, message) => logs.push({ level, message }) })
  controller.initialize()

  await controller.check(false)
  updater.emit('error', new Error('offline'))
  await nextTurn()

  assert.equal(controller.state, 'idle')
  assert.equal(messages.length, 0)
  assert.match(logs.at(-1).message, /offline/)
})
