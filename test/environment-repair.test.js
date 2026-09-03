import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'
import { repairDesktopEnvironment } from '../src/environment-repair.js'
import { readPluginCatalog } from '../src/plugin-management.js'

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-environment-repair-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

function writeDesktopPlugin(directory) {
  writeJson(join(directory, 'package.json'), {
    name: '@dsh-desktop/integration',
    version: '0.1.0',
    main: 'lib/index.js',
  })
  mkdirSync(join(directory, 'lib'), { recursive: true })
  writeFileSync(join(directory, 'lib', 'index.js'), 'export function apply() {}\n')
  writeFileSync(join(directory, 'lib', 'client.js'), 'export {}\n')
}

function writeBundledPlugin(directory, name, version) {
  writeJson(join(directory, 'package.json'), {
    name,
    version,
    main: 'index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  writeFileSync(join(directory, 'index.js'), 'export {}\n')
  writeFileSync(join(directory, 'cordis.patch.yml'), 'include: []\n')
}

test('repairs the Desktop-owned Harness runtime environment from bundled sources', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const toolchainDirectory = join(directory, 'toolchain')
  const desktopPluginDir = join(directory, 'app', 'desktop-plugin')
  const remotePluginDir = join(directory, 'app', 'node_modules', 'ds-harness-remote')
  const fileViewerPluginDir = join(directory, 'app', 'node_modules', 'dsh-file-viewer')
  const logs = []
  writeDesktopPlugin(desktopPluginDir)
  writeBundledPlugin(remotePluginDir, 'ds-harness-remote', '0.4.7')
  writeBundledPlugin(fileViewerPluginDir, 'dsh-file-viewer', '0.3.1')

  const report = await repairDesktopEnvironment({
    dshHome,
    toolchainDirectory,
    execPath: '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop',
    pnpmEntry: '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/pnpm/bin/pnpm.mjs',
    desktopPluginDir,
    remotePluginDir,
    fileViewerPluginDir,
    env: { PATH: '/usr/bin' },
    onOutput: (source, text) => logs.push({ source, text }),
  })

  assert.equal(report.ok, true)
  assert.equal(report.failedCount, 0)
  assert.ok(report.appliedCount >= 5)
  assert.equal(report.env.PATH, `${toolchainDirectory}${delimiter}/usr/bin`)
  for (const name of ['profiles', 'sessions', 'storages', 'skills', 'scripts', 'cache']) {
    assert.equal(existsSync(join(dshHome, name)), true)
  }
  assert.equal(existsSync(join(dshHome, 'profiles', 'web', 'package.json')), true)
  const nodeLauncher = process.platform === 'win32' ? 'node.cmd' : 'node'
  assert.match(readFileSync(join(toolchainDirectory, nodeLauncher), 'utf8'), /ELECTRON_RUN_AS_NODE=1/)
  assert.equal(
    readFileSync(join(dshHome, 'profiles', 'node_modules', '@dsh-desktop', 'integration', 'lib', 'client.js'), 'utf8'),
    'export {}\n',
  )

  const catalog = readPluginCatalog({ dshHome })
  assert.deepEqual(catalog.plugins.map(plugin => plugin.name), ['ds-harness-remote', 'dsh-file-viewer'])
  assert.equal(catalog.plugins.every(plugin => plugin.enabled), true)
  assert.match(logs.map(item => item.text).join(''), /Runtime environment repair completed/)
})

test('reports a failed bundled repair step and continues with later steps', async (t) => {
  const directory = temporaryDirectory(t)
  const dshHome = join(directory, 'dsh-home')
  const toolchainDirectory = join(directory, 'toolchain')
  const desktopPluginDir = join(directory, 'app', 'desktop-plugin')
  const remotePluginDir = join(directory, 'app', 'node_modules', 'ds-harness-remote')
  const fileViewerPluginDir = join(directory, 'app', 'node_modules', 'dsh-file-viewer')
  writeDesktopPlugin(desktopPluginDir)
  writeBundledPlugin(remotePluginDir, 'wrong-remote-name', '0.4.7')
  writeBundledPlugin(fileViewerPluginDir, 'dsh-file-viewer', '0.3.1')

  const report = await repairDesktopEnvironment({
    dshHome,
    toolchainDirectory,
    execPath: '/bin/node',
    pnpmEntry: '/app/node_modules/pnpm/bin/pnpm.mjs',
    desktopPluginDir,
    remotePluginDir,
    fileViewerPluginDir,
  })

  assert.equal(report.ok, false)
  assert.equal(report.failedCount, 1)
  assert.match(report.summary, /1 failed step/)
  assert.equal(report.actions.find(action => action.kind === 'remote-plugin')?.status, 'failed')
  assert.equal(existsSync(join(dshHome, 'profiles', 'web', 'node_modules', 'dsh-file-viewer', 'package.json')), true)
})
