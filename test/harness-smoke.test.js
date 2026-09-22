import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { installDesktopPlugin, prepareHarnessToolchain } from '../src/desktop-integration.js'
import { buildHarnessArgs, HarnessServer } from '../src/harness-server.js'
import { installBundledRemotePlugin } from '../src/plugin-management.js'

const require = createRequire(import.meta.url)
const source = fileURLToPath(new URL('../src/', import.meta.url))

test('bundled Electron boots Harness Web and our plugins with a GUI-only PATH', {
  timeout: 120_000,
  // Hosted Windows runners can terminate Electron during native DLL initialization.
  skip: process.platform === 'win32' && process.env.CI === 'true',
}, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  let server
  t.after(async () => {
    await server?.stop()
    rmSync(directory, { recursive: true, force: true })
  })
  const dshHome = join(directory, 'home')
  const electron = require('electron')
  const pnpmEntry = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')
  installDesktopPlugin({ sourceDir: join(source, 'plugins', 'dsh-desktop-integration'), dshHome })
  await installBundledRemotePlugin({ sourceDir: dirname(require.resolve('ds-harness-remote/package.json')), dshHome })
  const env = prepareHarnessToolchain({
    directory: join(directory, 'toolchain'),
    execPath: electron,
    pnpmEntry,
    env: {
      PATH: process.platform === 'win32' ? join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin',
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot } : {}),
      HOME: directory,
      USERPROFILE: directory,
      TMPDIR: directory,
      TEMP: directory,
      TMP: directory,
      DSH_HOME: dshHome,
      DSH_AGENTS_HOME: join(directory, 'agents'),
      DSH_TELEMETRY_DISABLED: '1',
      ELECTRON_RUN_AS_NODE: '1',
      DSH_DESKTOP: '1',
      NO_COLOR: '1',
    },
  })
  server = new HarnessServer({
    command: electron,
    args: buildHarnessArgs({
      entry: require.resolve('@deepseek-ai/dsh/lib/bin.js'),
      parentWatch: join(source, 'parent-watch.cjs'),
      patch: join(source, 'dsh-desktop.patch.yml'),
    }),
    cwd: directory,
    env,
    startupTimeoutMs: 90_000,
    spawnImpl(command, args, options) {
      assert.equal(command, electron)
      assert.equal(options.shell, false)
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1')
      assert.equal(args[4], 'web')
      return spawn(command, args, options)
    },
  })
  const url = await server.start()
  // The launch URL exchanges its token for the browser's persistent auth cookie.
  const exchange = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  assert.ok(exchange.status >= 300 && exchange.status < 400)
  const cookies = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookies)
  const response = await fetch(new URL(exchange.headers.get('location'), url), {
    headers: { cookie: cookies },
    signal: AbortSignal.timeout(15_000),
  })
  assert.equal(response.status, 200)
  const html = await response.text()
  for (const name of ['@dsh-desktop/integration', 'ds-harness-remote']) {
    assert.ok(html.includes(name), `Missing client plugin ${name}\n${server.diagnosticOutput()}`)
  }
  assert.doesNotMatch(html, /@deepseek-ai\/dsh-desktop(?:-host)?["/]/)
  assert.doesNotMatch(server.diagnosticOutput(), /ERR_MODULE_NOT_FOUND|Cannot find package/)
})
