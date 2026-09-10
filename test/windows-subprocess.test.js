import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const fixture = fileURLToPath(new URL('../scripts/fixtures/windows-subprocess-probe.cjs', import.meta.url))

test('Windows managed PowerShell stays windowless under bundled Electron with a GUI-style PATH', {
  skip: process.platform !== 'win32',
  timeout: 120_000,
}, () => {
  const electron = require('electron')
  const shells = [
    join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
  ].filter(existsSync)
  assert.ok(shells.length > 0, 'A Windows PowerShell installation is required')
  const cwd = mkdtempSync(join(tmpdir(), 'dsh console regression '))
  try {
    for (const shell of shells) {
      const result = spawnSync(electron, [fixture, shell], {
        cwd,
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 50_000,
        env: {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.SystemRoot,
          TEMP: cwd,
          TMP: cwd,
          PATH: join(process.env.SystemRoot, 'System32'),
          ELECTRON_RUN_AS_NODE: '1',
        },
      })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 0, `${shell}\n${result.stderr}\n${result.stdout}`)
      assert.match(result.stdout, /windowless PowerShell and cancellation verified/)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
