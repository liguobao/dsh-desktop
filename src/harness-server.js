import { EventEmitter } from 'node:events'
import process from 'node:process'
import { spawn as nodeSpawn } from 'node:child_process'

const READY_URL = /(?:^|\n)dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)(?:\s|$)/

/** @param {import('node:child_process').ChildProcess} child @param {NodeJS.Signals} signal */
function signalProcessTree(child, signal) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return

  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') {
      const killer = nodeSpawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.unref()
      return
    }
    child.kill()
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

/** @param {import('node:child_process').ChildProcess} child @param {number} timeoutMs */
function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

/**
 * Owns one `dsh web` process and resolves only after its documented readiness
 * line is observed.
 */
export class HarnessServer extends EventEmitter {
  /**
   * @param {{
   *   command: string,
   *   args: string[],
   *   cwd: string,
   *   env: NodeJS.ProcessEnv,
   *   startupTimeoutMs?: number,
   *   shutdownTimeoutMs?: number,
   *   spawnImpl?: typeof nodeSpawn,
   *   onOutput?: (source: 'stdout' | 'stderr', text: string) => void,
   *   signalImpl?: typeof signalProcessTree,
   * }} options
   */
  constructor(options) {
    super()
    this.options = options
    this.child = undefined
    this.startPromise = undefined
    this.stopPromise = undefined
    this.output = ''
    this.url = undefined
  }

  start() {
    if (this.startPromise !== undefined) return this.startPromise
    this.startPromise = this.#start()
    return this.startPromise
  }

  async #start() {
    const {
      command,
      args,
      cwd,
      env,
      spawnImpl = nodeSpawn,
      startupTimeoutMs = 120_000,
      onOutput = () => {},
    } = this.options

    const child = spawnImpl(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      // Keeping stdin as an otherwise-unused pipe lets the child detect a
      // crashed desktop parent (see parent-watch.cjs).
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child

    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, url) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error !== undefined) reject(error)
        else resolve(url)
      }
      const receive = (source, chunk) => {
        const text = String(chunk)
        onOutput(source, text)
        this.output = `${this.output}${text}`.slice(-16_384)
        const match = this.output.match(READY_URL)
        if (match?.[1] !== undefined) {
          this.url = match[1]
          finish(undefined, match[1])
        }
      }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', chunk => receive('stdout', chunk))
      child.stderr?.on('data', chunk => receive('stderr', chunk))
      child.once('error', error => finish(new Error(`Unable to start DeepSeek Harness: ${error.message}`, { cause: error })))
      child.once('exit', (code, signal) => {
        this.emit('exit', { code, signal, ready: this.url !== undefined })
        finish(new Error(`DeepSeek Harness exited before it was ready (code: ${String(code)}, signal: ${String(signal)}).`))
      })

      const timeout = setTimeout(() => {
        finish(new Error(`DeepSeek Harness did not become ready within ${Math.round(startupTimeoutMs / 1000)} seconds.`))
      }, startupTimeoutMs)
    })
  }

  stop() {
    if (this.stopPromise !== undefined) return this.stopPromise
    this.stopPromise = this.#stop()
    return this.stopPromise
  }

  async #stop() {
    const child = this.child
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
    const signal = this.options.signalImpl ?? signalProcessTree
    signal(child, 'SIGTERM')
    const exited = await waitForExit(child, this.options.shutdownTimeoutMs ?? 7_000)
    if (!exited) {
      signal(child, 'SIGKILL')
      await waitForExit(child, 2_000)
    }
  }
}

export const internals = { READY_URL, waitForExit }
