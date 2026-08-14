import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const packageUrl = new URL('../src/plugins/dsh-desktop-integration/package.json', import.meta.url)
const clientUrl = new URL('../src/plugins/dsh-desktop-integration/lib/client.js', import.meta.url)
const overlayUrl = new URL('../src/dsh-desktop.patch.yml', import.meta.url)

test('desktop adapter is a standalone dual-face DSH client package', () => {
  const manifest = JSON.parse(readFileSync(packageUrl, 'utf8'))
  assert.equal(manifest.name, '@dsh-desktop/integration')
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-runtime'])
})

test('desktop overlay adds only the adapter plugin', () => {
  const overlay = readFileSync(overlayUrl, 'utf8')
  assert.match(overlay, /id: dsh-desktop-integration/)
  assert.match(overlay, /name: '@dsh-desktop\/integration'/)
  assert.doesNotMatch(overlay, /id:\s+(?:api-gateway|ui-conversation|ui-workspace)\b/)
})

test('client adapter delegates existing openPath calls and publishes workspace context', () => {
  const source = readFileSync(clientUrl, 'utf8')
  assert.match(source, /workspaces\.openPath = openPath/)
  assert.match(source, /bridge\.openPath\(path\)/)
  assert.match(source, /bridge\.publishWorkspaceContext/)
  assert.doesNotMatch(source, /child_process|exec\(|spawn\(/)
})

test('client adapter replaces and restores the Harness path action at runtime', async () => {
  const source = readFileSync(clientUrl, 'utf8')
  let registration
  const opened = []
  const published = []
  const bridge = {
    openPath: async path => {
      opened.push(path)
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
  const plugin = registration.factory()
  assert.deepEqual(Array.from(plugin.inject), ['sessions', 'workspaces'])

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
  let dispose
  plugin.apply({
    sessions,
    workspaces,
    effect: callback => { dispose = callback() },
  })

  assert.notEqual(workspaces.openPath, originalOpenPath)
  await workspaces.openPath('/workspace/src/main.js')
  assert.deepEqual(opened, ['/workspace/src/main.js'])
  assert.deepEqual(JSON.parse(JSON.stringify(published)), [{ active: '/workspace', roots: ['/workspace'] }])
  assert.equal(subscribers.length, 2)

  sessionSnapshot.current = undefined
  subscribers[0]()
  assert.deepEqual(JSON.parse(JSON.stringify(published.at(-1))), { active: '/workspace', roots: ['/workspace'] })

  dispose()
  assert.equal(workspaces.openPath, originalOpenPath)
})
