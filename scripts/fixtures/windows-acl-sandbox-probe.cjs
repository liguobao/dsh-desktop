'use strict'

const assert = require('node:assert/strict')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const koffi = require('koffi')
const {
  AclSandbox,
  tempWriteSid,
  workspaceWriteSid,
} = require('@deepseek-ai/dsh-sandbox-windows-acl')

const kernel32 = koffi.load('kernel32.dll')
const user32 = koffi.load('user32.dll')
const attachConsole = kernel32.func('__stdcall', 'AttachConsole', 'int', ['uint32'])
const freeConsole = kernel32.func('__stdcall', 'FreeConsole', 'int', [])
const getConsoleWindow = kernel32.func('__stdcall', 'GetConsoleWindow', 'void *', [])
const isWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['void *'])

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const psLiteral = value => value.replaceAll("'", "''")

async function inspectConsole(pid) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (attachConsole(pid) !== 0) {
      try {
        const hwnd = getConsoleWindow()
        return {
          attached: true,
          hasConsole: hwnd !== null,
          visible: hwnd !== null && isWindowVisible(hwnd) !== 0,
        }
      } finally {
        freeConsole()
      }
    }
    await sleep(25)
  }
  return { attached: false, hasConsole: false, visible: false }
}

async function verifyCase(shell, mode) {
  const root = mkdtempSync(join(tmpdir(), `dsh windows acl ${mode} `))
  const workspace = join(root, 'workspace')
  const privateTemp = join(root, 'temp')
  const insidePath = join(workspace, 'inside.txt')
  const outsidePath = join(root, 'outside.txt')
  mkdirSync(workspace)
  mkdirSync(privateTemp)

  const sandbox = mode === 'read-only'
    ? new AclSandbox({ writableDirs: [], tempDir: null, mode })
    : new AclSandbox({
        writableDirs: [workspace],
        tempDir: privateTemp,
        mode,
        writeSid: workspaceWriteSid(workspace),
        tempWriteSid: tempWriteSid(privateTemp),
      })

  try {
    await sandbox.init()
    const command = [
      `try { Set-Content -LiteralPath '${psLiteral(insidePath)}' -Value ok -ErrorAction Stop } catch {}`,
      `try { Set-Content -LiteralPath '${psLiteral(outsidePath)}' -Value no -ErrorAction Stop } catch {}`,
      'Start-Sleep -Milliseconds 2500',
    ].join('; ')
    const child = sandbox.spawn({
      command: shell,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      cwd: workspace,
      stdio: 'inherit',
    })

    const consoleState = await inspectConsole(child.pid)
    const result = await child.wait()
    assert.equal(result.exitCode, 0, `${mode} ${shell} should exit successfully`)
    assert.equal(consoleState.visible, false, `${mode} ${shell} must not show a console window`)
    assert.equal(existsSync(outsidePath), false, `${mode} ${shell} wrote outside the workspace`)
    if (mode === 'read-only') {
      assert.equal(existsSync(insidePath), false, `${mode} ${shell} wrote inside the workspace`)
    } else {
      assert.equal(readFileSync(insidePath, 'utf8').trim(), 'ok', `${mode} ${shell} did not write inside the workspace`)
    }
  } finally {
    try {
      sandbox.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

async function main() {
  assert.equal(getConsoleWindow(), null, 'Electron host must have no console')
  const shells = process.argv.slice(2)
  assert.ok(shells.length > 0, 'At least one PowerShell executable is required')
  for (const shell of shells) {
    for (const mode of ['read-only', 'workspace-write']) await verifyCase(shell, mode)
  }
  console.log('windows ACL sandbox console and permissions verified')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
