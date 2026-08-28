import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const packageUrl = new URL('../src/plugins/dsh-desktop-integration/package.json', import.meta.url)
const clientUrl = new URL('../src/plugins/dsh-desktop-integration/lib/client.js', import.meta.url)
const overlayUrl = new URL('../src/dsh-desktop.patch.yml', import.meta.url)
const preloadUrl = new URL('../src/preload.cjs', import.meta.url)
const mainUrl = new URL('../src/main.js', import.meta.url)

test('desktop adapter is a standalone dual-face DSH client package', () => {
  const manifest = JSON.parse(readFileSync(packageUrl, 'utf8'))
  assert.equal(manifest.name, '@dsh-desktop/integration')
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-workspace',
  ])
})

test('desktop overlay adds only the adapter', () => {
  const overlay = readFileSync(overlayUrl, 'utf8')
  assert.match(overlay, /id: dsh-desktop-integration/)
  assert.match(overlay, /name: '@dsh-desktop\/integration'/)
  assert.doesNotMatch(overlay, /tool-subagent-codex-enabled/)
  assert.doesNotMatch(overlay, /provider: codex/)
  assert.doesNotMatch(overlay, /toolName: subagent_codex/)
  assert.doesNotMatch(overlay, /disabled:\s+true/)
  assert.doesNotMatch(overlay, /id:\s+(?:api-gateway|ui-conversation|ui-workspace)\b/)
})

test('client adapter exposes native actions without spawning local processes', () => {
  const source = readFileSync(clientUrl, 'utf8')
  assert.match(source, /workspaces\.openPath = openPath/)
  assert.match(source, /bridge\.openPath\(path, 'auto'\)/)
  assert.match(source, /bridge\.publishWorkspaceContext/)
  assert.doesNotMatch(source, /conversation\.session\.header\.utilities/)
  assert.doesNotMatch(source, /dsh-desktop-workspace-editor/)
  assert.match(source, /installWorkspaceMenuActions/)
  assert.match(source, /'editor', pendingPath, 'editor'/)
  assert.match(source, /'fileManager', pendingPath, 'default'/)
  assert.match(source, /用编辑器打开/)
  assert.match(source, /打开文件夹/)
  assert.match(source, /Open Folder/)
  assert.doesNotMatch(source, /child_process|exec\(|spawn\(/)
})

test('preload and main process pass only recognized native open intents', () => {
  const preload = readFileSync(preloadUrl, 'utf8')
  const main = readFileSync(mainUrl, 'utf8')
  assert.match(preload, /openPath: \(path, intent = 'auto'\)/)
  assert.match(preload, /repairEnvironment: \(\) => ipcRenderer\.invoke\('dsh-desktop:repair-environment'\)/)
  assert.match(main, /\['auto', 'editor', 'default'\]\.includes\(intent\)/)
  assert.match(main, /openDesktopPath\(path, intent\)/)
  assert.match(main, /senderIsEnvironmentRepairPage\(event\)/)
  assert.match(main, /ipcMain\.handle\('dsh-desktop:repair-environment'/)
  assert.match(main, /render-process-gone/)
})

test('client adapter replaces and restores the Harness path action at runtime', async () => {
  const source = readFileSync(clientUrl, 'utf8')
  let registration
  const opened = []
  const published = []
  const bridge = {
    openPath: async (path, intent) => {
      opened.push({ path, intent })
      return { ok: true }
    },
    publishWorkspaceContext: value => published.push(value),
  }
  const context = vm.createContext({
    console,
    dshDesktop: bridge,
    window: { __ModuleLoader__: { load: value => { registration = value } } },
  })
  vm.runInContext(source, context)

  assert.equal(registration.id, '@dsh-desktop/integration')
  const plugin = registration.factory(() => assert.fail('client adapter should not require UI modules'))
  assert.deepEqual(Array.from(plugin.inject), ['sessions', 'workspaces', 'locale'])

  const subscribers = []
  const originalOpenPath = async () => { throw new Error('unexpected fallback') }
  const workspaceSnapshot = {
    items: [{ path: '/workspace', workspaceId: 'workspace-1' }],
    recentWorkspaceId: 'workspace-1',
  }
  const workspaces = {
    list: {
      getSnapshot: () => workspaceSnapshot,
      subscribe: callback => {
        subscribers.push(callback)
        return () => {}
      },
    },
    openPath: originalOpenPath,
  }
  const sessionSnapshot = {
    current: 'session-1',
    byId: { 'session-1': { cwd: '/workspace' } },
  }
  const sessions = {
    list: {
      getSnapshot: () => sessionSnapshot,
      subscribe: callback => {
        subscribers.push(callback)
        return () => {}
      },
    },
  }
  const effects = []
  plugin.apply({
    sessions,
    workspaces,
    locale: {
      register: () => () => {},
      bind: () => key => key,
    },
    effect: callback => {
      const dispose = callback()
      if (typeof dispose === 'function') effects.push(dispose)
    },
  })

  assert.notEqual(workspaces.openPath, originalOpenPath)
  await workspaces.openPath('/workspace/src/main.js')
  assert.deepEqual(opened, [{ path: '/workspace/src/main.js', intent: 'auto' }])
  assert.deepEqual(JSON.parse(JSON.stringify(published)), [{ active: '/workspace', roots: ['/workspace'] }])
  assert.equal(subscribers.length, 2)
  sessionSnapshot.current = undefined
  subscribers[0]()
  assert.deepEqual(JSON.parse(JSON.stringify(published.at(-1))), { active: '/workspace', roots: ['/workspace'] })

  for (const dispose of effects.reverse()) dispose()
  assert.equal(workspaces.openPath, originalOpenPath)
})
