'use strict'

const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const { syncBuiltinESMExports } = require('node:module')
const koffi = require('koffi')

// Observe the real runner invocation; never substitute a mock process.
const invocations = []
const originalSpawn = childProcess.spawn
childProcess.spawn = (...args) => {
  invocations.push(args)
  return originalSpawn(...args)
}
syncBuiltinESMExports()

async function main() {
  const { Context } = await import('@deepseek-ai/cordis')
  const { LocalSubprocessRuntime } = await import('@deepseek-ai/dsh-subprocess-local')
  const getConsoleWindow = koffi.load('kernel32.dll').func('void *GetConsoleWindow()')
  assert.equal(getConsoleWindow(), null, 'Electron host must have no console')
  const ctx = new Context()
  const runtime = new LocalSubprocessRuntime(ctx)
  const makeSpec = command => ({
    argv: [process.argv[2], '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    cwd: process.cwd(),
    env: { DSH_CONSOLE_TEST: 'env-marker' },
    stdio: { stdin: { data: 'stdin-marker\n' }, stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } },
    graceMs: 100,
  })
  try {
    const command = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'; @{ hasConsole = ([ConsoleProbe]::GetConsoleWindow() -ne [IntPtr]::Zero); text = '中文输出'; input = [Console]::In.ReadLine(); cwd = (Get-Location).Path; env = $env:DSH_CONSOLE_TEST } | ConvertTo-Json -Compress; [Console]::Error.WriteLine('stderr-marker'); exit 7`
    const proc = runtime.spawn(makeSpec(command))
    const outcome = await proc.done
    await proc.waitForExit()
    const output = JSON.parse(proc.collected.stdout.readFrom(0).text)
    assert.equal(output.hasConsole, false, 'PowerShell must not allocate a console')
    assert.equal(output.text, '中文输出')
    assert.equal(output.input, 'stdin-marker')
    assert.equal(output.cwd.toLowerCase(), process.cwd().toLowerCase())
    assert.equal(output.env, 'env-marker')
    assert.equal(proc.collected.stderr.readFrom(0).text.trim(), 'stderr-marker')
    assert.equal(outcome.exitCode, 7)

    const controller = new AbortController()
    const longRunning = runtime.spawn({ ...makeSpec("[Console]::Out.WriteLine('ready'); Start-Sleep -Seconds 60"), signal: controller.signal })
    const deadline = Date.now() + 15_000
    while (!longRunning.collected.stdout.readFrom(0).text.includes('ready')) {
      assert.ok(Date.now() < deadline, 'Long-running command did not become ready')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    controller.abort()
    const stopped = await longRunning.done
    await longRunning.waitForExit()
    assert.equal(stopped.exitCode, 1)

    assert.equal(invocations.length, 2, 'Both commands must use the managed runner')
    for (const [exe, args, options] of invocations) {
      assert.equal(exe, process.execPath, 'Use bundled Electron, never a PATH node/npm/pnpm')
      assert.match(args[0], /runner\.js$/)
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1')
      assert.equal(options.env.PATH, process.env.PATH)
      assert.equal(options.windowsHide, true)
      assert.equal(options.shell ?? false, false)
    }
    console.log('windowless PowerShell and cancellation verified')
  } finally {
    await runtime.disposeManagedProcesses()
    await ctx.fiber.dispose()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
