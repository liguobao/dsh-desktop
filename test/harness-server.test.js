import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { HarnessServer } from '../src/harness-server.js'

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
  child.stdout.write('1:45678\n')
  assert.equal(await ready, 'http://127.0.0.1:45678')
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
  child.exitCode = 1
  child.emit('exit', 1, null)
  await assert.rejects(ready, /exited before it was ready/)
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
