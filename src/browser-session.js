/** Current browser-session auth cookie name issued by the Host Connection carrier. */
export const AUTH_COOKIE_PREFIX = 'dsh-auth-'

/** Hosts whose cookie jar DSH Desktop owns: one per loopback spelling the Host may bind. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

/**
 * Which auth cookies a loopback host must keep.
 *
 * The Harness names its browser-session cookie `dsh-auth-<sha256(authority)>`, so
 * the name changes whenever the Host listens on another port while the cookie
 * itself is long lived (`Max-Age` in the days). Every restart therefore leaves
 * one more cookie behind, and the browser sends all of them on every request.
 * `mainWindow.loadURL(harnessUrl)` sets exactly one fresh cookie, so the newest
 * entry is the live one and everything older is dead weight.
 *
 * @param {Array<{ name?: unknown, expirationDate?: unknown }>} entries - cookies already filtered to the loopback hosts
 * @returns {Array<{ name: string, expirationDate: number }>} the entries that should be removed
 */
export function selectStaleAuthCookies(entries) {
  /** @type {Map<string, Array<{ name: string, expirationDate: number }>>} */
  const byHost = new Map()
  for (const entry of entries) {
    if (typeof entry?.name !== 'string' || !entry.name.startsWith(AUTH_COOKIE_PREFIX)) continue
    const host = typeof entry.domain === 'string' ? entry.domain.replace(/^\./, '') : ''
    if (!LOOPBACK_HOSTS.has(host)) continue
    const expirationDate = typeof entry.expirationDate === 'number' && Number.isFinite(entry.expirationDate)
      ? entry.expirationDate
      : 0
    const group = byHost.get(host)
    if (group === undefined) byHost.set(host, [{ name: entry.name, expirationDate }])
    else group.push({ name: entry.name, expirationDate })
  }

  const stale = []
  for (const group of byHost.values()) {
    // Newest first; the first entry is the cookie the current window just received.
    group.sort((left, right) => right.expirationDate - left.expirationDate)
    stale.push(...group.slice(1))
  }
  return stale
}

/** Bound the whole pass so a slow cookie store can never stall the window load. */
const DEFAULT_TIMEOUT_MS = 1_000

/**
 * Drop stale Harness auth cookies from the window's session.
 *
 * Without this, a handful of Host restarts is enough for the accumulated
 * `dsh-auth-*` cookies to push the plugin-bundle request line past the Host's
 * header budget, which answers `431` and leaves the renderer stuck on
 * "Failed to load plugins".
 *
 * Never throws: a cleanup failure must not stop the Harness from starting.
 *
 * @param {{
 *   cookiesForHost?: (url: string) => Promise<Array<{ name?: unknown, domain?: unknown, expirationDate?: unknown }>>,
 *   removeCookie?: (url: string, name: string) => Promise<void>,
 *   log?: (message: string) => void,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<number>} how many cookies were removed
 */
export async function pruneStaleAuthCookies({
  cookiesForHost,
  removeCookie,
  log = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof cookiesForHost !== 'function' || typeof removeCookie !== 'function') return 0

  const cleanup = (async () => {
    let removed = 0
    for (const host of LOOPBACK_HOSTS) {
      const url = `http://${host}/`
      let entries = []
      try {
        entries = (await cookiesForHost(url)) ?? []
      } catch {
        continue
      }
      for (const stale of selectStaleAuthCookies(entries)) {
        try {
          await removeCookie(url, stale.name)
          removed += 1
        } catch {
          // A cookie that cannot be removed is not worth failing the boot over.
        }
      }
    }
    return removed
  })()

  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })

  const outcome = await Promise.race([cleanup, timeout])
  clearTimeout(timer)
  if (outcome === 'timeout') {
    log(`Harness session cookie cleanup timed out after ${String(timeoutMs)} ms\n`)
    return 0
  }
  if (outcome > 0) {
    log(`Removed ${String(outcome)} stale Harness session cookie(s) for the loopback origin.\n`)
  }
  return outcome
}

/**
 * Electron-flavoured wrapper: prune the window session's loopback auth cookies
 * before a Harness URL is loaded.
 *
 * @param {{ cookies: { get: Function, remove: Function } }} session
 * @param {(message: string) => void} log
 * @returns {Promise<number>} how many cookies were removed
 */
export function pruneHarnessSessionCookies(session, log = () => {}) {
  return pruneStaleAuthCookies({
    cookiesForHost: async (url) => (await session?.cookies?.get?.({ url })) ?? [],
    removeCookie: (url, name) => {
      const remove = session?.cookies?.remove
      return typeof remove === 'function' ? remove.call(session.cookies, url, name) : undefined
    },
    log,
  })
}
