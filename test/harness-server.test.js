import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { buildHarnessArgs, HarnessServer } from '../src/harness-server.js'

test('embedded Web launch disables the upstream default-browser handoff', () => {
  assert.deepEqual(buildHarnessArgs({
    entry: '/app/dsh/bin.js',
    parentWatch: '/app/parent-watch.cjs',
    patch: '/app/desktop.patch.yml',
  }), [
    '--expose-internals',
    '--require',
    '/app/parent-watch.cjs',
    '/app/dsh/bin.js',
    'web',
    '--patch',
    '/app/desktop.patch.yml',
    '--port',
    '0',
    '--no-open',
  ])
})

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.pid = 1234
  child.exitCode = null
  child.signalCode = null
  child.kill = () => true
  return child
}

test('resolves after a split readiness line and captures output', async () => {
  const child = fakeChild()
  const output = []
  const server = new HarnessServer({
    command: 'electron',
    args: [],
    cwd: '/',
    env: {},
    spawnImpl: () => child,
    onOutput: (source, text) => output.push([source, text]),
  })
  const ready = server.start()
  child.stdout.write('booting\ndsh web: http://127.0.0.')
  child.stdout.write('1:45678/?token=abc_DEF-123 (LAN: http://192.168.1.5:45678/?token=abc_DEF-123)\n')
  assert.equal(await ready, 'http://127.0.0.1:45678/?token=abc_DEF-123')
  assert.equal(output.length, 2)
})

test('rejects when the child exits before readiness', async () => {
  const child = fakeChild()
  const server = new HarnessServer({
    command: 'electron',
    args: [],
    cwd: '/',
    env: {},
    spawnImpl: () => child,
  })
  const ready = server.start()
  child.stdout.write('booting profile\n')
  child.stderr.write('Error: cannot resolve bundle with token=abc_DEF-123 and apiKey: shh\n')
  child.exitCode = 1
  child.emit('exit', 1, null)
  await assert.rejects(ready, (error) => {
    assert.match(error.message, /exited before it was ready/)
    assert.match(error.message, /Recent Harness output:/)
    assert.match(error.message, /\[stdout\] booting profile/)
    assert.match(error.message, /\[stderr\] Error: cannot resolve bundle with token=\[REDACTED\] and apiKey: \[REDACTED\]/)
    assert.doesNotMatch(error.message, /abc_DEF-123|shh/)
    return true
  })
})

test('spawns Harness with explicit argv and a GUI-style PATH', async () => {
  const child = fakeChild()
  const args = ['--require', '/app/parent-watch.cjs', '/app/dsh/bin.js', 'web']
  let invocation
  const server = new HarnessServer({
    command: '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop',
    args,
    cwd: '/Users/test',
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      PATH: '/usr/bin:/bin',
    },
    spawnImpl: (command, spawnArgs, options) => {
      invocation = { command, args: spawnArgs, options }
      return child
    },
  })
  const ready = server.start()
  child.stdout.write('dsh web: http://127.0.0.1:45678/?token=abc_DEF-123\n')

  assert.equal(await ready, 'http://127.0.0.1:45678/?token=abc_DEF-123')
  assert.equal(invocation.command, '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop')
  assert.deepEqual(invocation.args, args)
  assert.equal(invocation.options.cwd, '/Users/test')
  assert.equal(invocation.options.env.PATH, '/usr/bin:/bin')
  assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(invocation.options.shell, false)
})

test('sends a graceful tree signal during stop', async () => {
  const child = fakeChild()
  const signals = []
  const server = new HarnessServer({
    command: 'electron',
    args: [],
    cwd: '/',
    env: {},
    spawnImpl: () => child,
    signalImpl: (_child, signal) => {
      signals.push(signal)
      child.signalCode = signal
      child.emit('exit', null, signal)
    },
  })
  const starting = server.start()
  await server.stop()
  await assert.rejects(starting, /exited before it was ready/)
  assert.deepEqual(signals, ['SIGTERM'])
})
