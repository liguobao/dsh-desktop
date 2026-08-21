import assert from 'node:assert/strict'
import test from 'node:test'
import { RELEASES_URL, createAutoUpdateController } from '../src/auto-update.js'

function fixture({ isPackaged = true, update = '1.1.0' } = {}) {
  const messages = []
  const opened = []
  const logs = []
  const handlers = {}
  let quitCalls = 0

  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on(event, handler) {
      handlers[event] = handler
      return this
    },
    async checkForUpdates() {
      handlers['checking-for-update']?.()
      if (update === null) {
        handlers['update-not-available']?.({ version: '1.0.0' })
        return { isUpdateAvailable: false, updateInfo: { version: '1.0.0' } }
      }
      handlers['update-available']?.({ version: update })
      return { isUpdateAvailable: true, updateInfo: { version: update } }
    },
    async downloadUpdate() {
      handlers['download-progress']?.({ percent: 42 })
      handlers['update-downloaded']?.({ version: update ?? '1.1.0' })
      return ['/tmp/update.bin']
    },
    quitAndInstall() {
      quitCalls += 1
    },
  }

  const controller = createAutoUpdateController({
    isPackaged,
    currentVersion: '1.0.0',
    updater,
    openReleasePage: async url => { opened.push(url) },
    dialog: {
      async showMessageBox(options) {
        messages.push(options)
        return { response: 0 }
      },
    },
    getWindow: () => undefined,
    onStateChange: () => {},
    log: (level, message) => { logs.push([level, message]) },
  })

  return {
    controller,
    handlers,
    logs,
    messages,
    opened,
    quitCalls: () => quitCalls,
    updater,
  }
}

test('updater events drive the state machine', () => {
  const { controller, handlers } = fixture()

  handlers['checking-for-update']()
  assert.equal(controller.state, 'checking')

  handlers['update-available']({ version: '1.1.0' })
  assert.equal(controller.state, 'available')
  assert.equal(controller.version, '1.1.0')

  handlers['download-progress']({ percent: 42 })
  assert.equal(controller.state, 'downloading')
  assert.equal(controller.progress, 42)

  handlers['update-downloaded']({ version: '1.1.0' })
  assert.equal(controller.state, 'downloaded')
  assert.equal(controller.progress, 100)
})

test('manual control flows are configured on the updater', () => {
  const { updater } = fixture()
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, true)
})

test('a manual check reports when the installed version is current', async () => {
  const { controller, messages } = fixture({ update: null })

  await controller.check(true)

  assert.equal(controller.state, 'idle')
  assert.equal(messages.at(-1).title, 'You’re Up to Date')
})

test('an available update downloads on demand and restarts on demand', async () => {
  const { controller, quitCalls } = fixture()

  await controller.check(false)
  assert.equal(controller.state, 'available')
  assert.equal(controller.menuItem().label, 'Download v1.1.0')

  await controller.download()
  assert.equal(controller.state, 'downloaded')
  assert.equal(controller.menuItem().label, 'Restart to Update')

  controller.restart()
  assert.equal(quitCalls(), 1)
})

test('restart is a no-op before the update is downloaded', async () => {
  const { controller, quitCalls } = fixture()

  await controller.check(false)
  controller.restart()

  assert.equal(quitCalls(), 0)
})

test('updater errors return to idle and are logged', () => {
  const { controller, handlers, logs } = fixture()

  handlers['error'](new Error('network down'))

  assert.equal(controller.state, 'idle')
  assert.match(logs[0][1], /network down/)
})

test('unsupported builds open the latest release from a manual check', async () => {
  const { controller, opened } = fixture({ isPackaged: false })

  await controller.check(true)

  assert.equal(controller.state, 'unsupported')
  assert.deepEqual(opened, [RELEASES_URL])
  assert.equal(controller.menuItem().label, 'View Latest Release…')
})

test('the menu item reflects each state', () => {
  const { controller, handlers } = fixture()

  assert.equal(controller.menuItem().label, 'Check for Updates…')

  handlers['checking-for-update']()
  assert.equal(controller.menuItem().label, 'Checking for Updates…')
  assert.equal(controller.menuItem().enabled, false)

  handlers['update-available']({ version: '1.2.0' })
  assert.equal(controller.menuItem().label, 'Download v1.2.0')
  assert.equal(controller.menuItem().enabled, true)

  handlers['download-progress']({ percent: 20 })
  assert.equal(controller.menuItem().label, 'Downloading Update… 20%')
  assert.equal(controller.menuItem().enabled, false)

  handlers['update-downloaded']({ version: '1.2.0' })
  assert.equal(controller.menuItem().label, 'Restart to Update')
})
