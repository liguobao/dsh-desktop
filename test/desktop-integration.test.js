import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  authorizeWorkspacePath,
  DESKTOP_PLUGIN_FILES,
  detectEditors,
  installDesktopPlugin,
  isTextLikePath,
  launchEditor,
  normalizeEditorPreference,
  normalizeWorkspaceContext,
  readDesktopSettings,
  resolveHarnessHome,
  selectedEditor,
  writeDesktopSettings,
} from '../src/desktop-integration.js'

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('resolves the Harness home with DSH_HOME and tilde semantics', () => {
  assert.equal(resolveHarnessHome({}, '/work', '/users/test'), resolve('/users/test/.dsh'))
  assert.equal(resolveHarnessHome({ DSH_HOME: '~/custom' }, '/work', '/users/test'), resolve('/users/test/custom'))
  assert.equal(resolveHarnessHome({ DSH_HOME: './custom' }, '/work', '/users/test'), resolve('/work/custom'))
  assert.equal(resolveHarnessHome({ DSH_HOME: '   ' }, '/work', '/users/test'), resolve('/users/test/.dsh'))
})

test('installs only the standalone adapter package into the DSH plugin fallback', (t) => {
  const dshHome = temporaryDirectory(t)
  const sourceDir = fileURLToPath(new URL('../src/plugins/dsh-desktop-integration/', import.meta.url))
  const target = installDesktopPlugin({ sourceDir, dshHome })

  for (const file of DESKTOP_PLUGIN_FILES) {
    assert.equal(readFileSync(join(target, file), 'utf8'), readFileSync(join(sourceDir, file), 'utf8'))
  }
  assert.equal(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name, '@dsh-desktop/integration')
})

test('authorizes existing files inside canonical workspace roots only', (t) => {
  const directory = temporaryDirectory(t)
  const workspace = join(directory, 'workspace')
  const outside = join(directory, 'outside.txt')
  const inside = join(workspace, 'inside.ts')
  mkdirSync(workspace)
  writeFileSync(inside, 'export {}\n')
  writeFileSync(outside, 'outside\n')
  const canonicalWorkspace = realpathSync(workspace)
  const canonicalInside = realpathSync(inside)

  const context = normalizeWorkspaceContext({ active: workspace, roots: [workspace, '/missing'] })
  assert.equal(context.active, canonicalWorkspace)
  assert.deepEqual(context.roots, [canonicalWorkspace])
  assert.equal(authorizeWorkspacePath(inside, context.roots), canonicalInside)
  assert.throws(() => authorizeWorkspacePath(outside, context.roots), /outside the active Harness workspaces/)
  assert.throws(() => authorizeWorkspacePath('relative.txt', context.roots), /absolute paths/)
  assert.throws(() => authorizeWorkspacePath(`${inside}\0ignored`, context.roots), /NUL character/)

  try {
    const link = join(workspace, 'outside-link')
    symlinkSync(outside, link)
    assert.throws(() => authorizeWorkspacePath(link, context.roots), /outside the active Harness workspaces/)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
})

test('detects supported editors from PATH and keeps preferences valid', (t) => {
  const directory = temporaryDirectory(t)
  const command = join(directory, 'code')
  writeFileSync(command, '#!/bin/sh\n')
  chmodSync(command, 0o755)

  const editors = detectEditors({ platform: 'linux', env: { PATH: directory } })
  assert.deepEqual(editors, [{ id: 'vscode', label: 'Visual Studio Code', command }])
  assert.equal(selectedEditor(editors, 'auto')?.id, 'vscode')
  assert.equal(normalizeEditorPreference('vscode', editors), 'vscode')
  assert.equal(normalizeEditorPreference('missing', editors), 'auto')
})

test('classifies code and text files without taking browser documents from their default app', () => {
  assert.equal(isTextLikePath('/workspace/src/main.ts'), true)
  assert.equal(isTextLikePath('/workspace/.gitignore'), true)
  assert.equal(isTextLikePath('/workspace/README'), true)
  assert.equal(isTextLikePath('/workspace/report.html'), false)
  assert.equal(isTextLikePath('/workspace/image.png'), false)
})

test('launches editors with argv and never through a shell', async () => {
  let invocation
  let unrefCalled = false
  const spawn = (command, args, options) => {
    invocation = { command, args, options }
    const child = new EventEmitter()
    child.unref = () => { unrefCalled = true }
    queueMicrotask(() => child.emit('spawn'))
    return child
  }

  await launchEditor({ command: '/opt/editor', id: 'test', label: 'Test' }, '/workspace/a file.ts', spawn)
  assert.equal(invocation.command, '/opt/editor')
  assert.deepEqual(invocation.args, ['/workspace/a file.ts'])
  assert.equal(invocation.options.shell, undefined)
  assert.equal(invocation.options.detached, true)
  assert.equal(unrefCalled, true)
})

test('persists the preferred editor in an app-owned settings document', (t) => {
  const file = join(temporaryDirectory(t), 'settings', 'desktop.json')
  assert.deepEqual(readDesktopSettings(file), { editor: 'auto' })
  writeDesktopSettings(file, { editor: 'cursor' })
  assert.deepEqual(readDesktopSettings(file), { editor: 'cursor' })
})
