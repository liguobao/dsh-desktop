import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCloseToTrayHandler,
  supportsCloseToTray,
  trayMenuTemplate,
} from '../src/window-lifecycle.js'

test('macOS and Windows close the main window to the tray', () => {
  for (const platform of ['darwin', 'win32']) {
    let prevented = false
    let hidden = false
    const handler = createCloseToTrayHandler({
      platform,
      isQuitting: () => false,
      hideWindow: () => { hidden = true },
    })

    assert.equal(handler({ preventDefault: () => { prevented = true } }), true)
    assert.equal(prevented, true)
    assert.equal(hidden, true)
  }
})

test('Linux and explicit app exit are not intercepted', () => {
  for (const options of [
    { platform: 'linux', quitting: false },
    { platform: 'darwin', quitting: true },
    { platform: 'win32', quitting: true },
  ]) {
    let prevented = false
    let hidden = false
    const handler = createCloseToTrayHandler({
      platform: options.platform,
      isQuitting: () => options.quitting,
      hideWindow: () => { hidden = true },
    })

    assert.equal(handler({ preventDefault: () => { prevented = true } }), false)
    assert.equal(prevented, false)
    assert.equal(hidden, false)
  }
  assert.equal(supportsCloseToTray('linux'), false)
})

test('tray menu can show the window and explicitly quit in both locales', () => {
  for (const [isChinese, labels] of [
    [false, ['Show DSH Desktop', 'Quit DSH Desktop']],
    [true, ['显示 DSH Desktop', '退出 DSH Desktop']],
  ]) {
    const actions = []
    const template = trayMenuTemplate({
      isChinese,
      showWindow: () => actions.push('show'),
      quitApp: () => actions.push('quit'),
    })

    assert.deepEqual(template.filter(item => item.label).map(item => item.label), labels)
    template[0].click()
    template[2].click()
    assert.deepEqual(actions, ['show', 'quit'])
  }
})
