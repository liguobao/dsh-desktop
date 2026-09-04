const TRAY_PLATFORMS = new Set(['darwin', 'win32'])

export function supportsCloseToTray(platform) {
  return TRAY_PLATFORMS.has(platform)
}

export function createCloseToTrayHandler({ platform, isQuitting, hideWindow }) {
  return (event) => {
    if (!supportsCloseToTray(platform) || isQuitting()) return false
    event.preventDefault()
    hideWindow()
    return true
  }
}

export function trayMenuTemplate({ isChinese, showWindow, quitApp }) {
  return [
    {
      label: isChinese ? '显示 DSH Desktop' : 'Show DSH Desktop',
      click: showWindow,
    },
    { type: 'separator' },
    {
      label: isChinese ? '退出 DSH Desktop' : 'Quit DSH Desktop',
      click: quitApp,
    },
  ]
}
