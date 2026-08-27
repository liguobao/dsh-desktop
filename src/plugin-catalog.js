import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizePluginSpec } from './plugin-management.js'

export const PLUGIN_TOPIC_URL = 'https://github.com/topics/dsh-plugin'
export const PLUGIN_REGISTRY_URL = 'https://awesome-dsh-plugin.com/plugins.json'
export const MAX_PLUGIN_CATALOG_BYTES = 2 * 1024 * 1024
export const MAX_PLUGIN_CATALOG_ENTRIES = 5_000
const EXTRA_CATALOG_PATH = join(import.meta.dirname, 'plugin-catalog.extra.json')

const INSTALL_PREFIX = 'dsh plugin --profile web add '
const GITHUB_OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i
const GITHUB_REPOSITORY_PATTERN = /^[a-z0-9._-]+$/i

function boundedText(value, maximum, fallback = '') {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  if (text === '') return fallback
  return text.length > maximum ? text.slice(0, maximum) : text
}

export function normalizePluginSourceUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid plugin source address')
  }
  const segments = url.pathname.split('/').filter(Boolean)
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'github.com'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
    || !GITHUB_OWNER_PATTERN.test(segments[0] ?? '')
    || !GITHUB_REPOSITORY_PATTERN.test(segments[1] ?? '')
  ) {
    throw new Error('Plugin sources must be GitHub repositories')
  }
  return `https://github.com/${segments.join('/')}`
}

function installSpec(entry) {
  const npm = boundedText(entry?.npm, 300)
  if (npm !== '') {
    const normalized = normalizePluginSpec(npm)
    if (normalized.source !== 'npm') throw new Error('Invalid npm catalog entry')
    return normalized
  }

  const explicit = boundedText(entry?.spec, 300)
  const command = boundedText(entry?.install, 500)
  const candidate = explicit !== ''
    ? explicit
    : command.startsWith(INSTALL_PREFIX) ? command.slice(INSTALL_PREFIX.length) : ''
  const normalized = normalizePluginSpec(candidate)
  if (normalized.source !== 'github') throw new Error('Invalid GitHub catalog entry')
  return normalized
}

function localizedDescription(value) {
  if (typeof value === 'string') {
    const description = boundedText(value, 1_000)
    return { en: description, zh: description }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { en: '', zh: '' }
  return {
    en: boundedText(value.en, 1_000, boundedText(value.zh, 1_000)),
    zh: boundedText(value.zh, 1_000, boundedText(value.en, 1_000)),
  }
}

function catalogCategories(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).slice(0, 40).flatMap(([id, labels]) => {
    if (!/^[a-z0-9_-]{1,40}$/i.test(id) || typeof labels !== 'object' || labels === null || Array.isArray(labels)) return []
    const en = boundedText(labels.en, 80)
    const zh = boundedText(labels.zh, 80, en)
    return [[id, { en, zh }]]
  }))
}

export function normalizePluginCatalog(value, { generatedAt } = {}) {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !Array.isArray(value.plugins)) {
    throw new Error('Invalid plugin catalog')
  }
  if (value.plugins.length > MAX_PLUGIN_CATALOG_ENTRIES) throw new Error('Plugin catalog is too large')

  const plugins = []
  const seen = new Set()
  for (const entry of value.plugins) {
    try {
      const normalized = installSpec(entry)
      const url = normalizePluginSourceUrl(entry.url)
      const sourceUrl = new URL(url)
      const sourceSegments = sourceUrl.pathname.split('/').filter(Boolean)
      const repository = `${sourceSegments[0]}/${sourceSegments[1]}`
      if (normalized.source === 'github' && normalized.repository.toLowerCase() !== repository.toLowerCase()) {
        throw new Error('GitHub catalog source does not match its install spec')
      }
      if (normalized.path !== undefined && !sourceUrl.pathname.endsWith(normalized.path)) {
        throw new Error('GitHub catalog path does not match its source')
      }
      const identity = normalized.source === 'npm'
        ? `npm:${normalized.packageName}`
        : `github:${normalized.repository.toLowerCase()}${normalized.path === undefined ? '' : `#path:${normalized.path}`}`
      if (seen.has(identity)) continue
      seen.add(identity)
      const stars = Number.isSafeInteger(entry.stars) && entry.stars >= 0 ? entry.stars : undefined
      plugins.push({
        name: boundedText(entry.name, 160, normalized.packageName ?? repository.split('/')[1]),
        owner: boundedText(entry.owner, 80, repository.split('/')[0]),
        repository,
        url,
        page: typeof entry.page === 'string' && entry.page.startsWith('https://awesome-dsh-plugin.com/')
          ? boundedText(entry.page, 500)
          : undefined,
        category: boundedText(entry.category, 40, 'other'),
        description: localizedDescription(entry.description),
        npm: normalized.source === 'npm' ? normalized.packageName : undefined,
        spec: normalized.spec,
        source: normalized.source,
        ...(normalized.path === undefined ? {} : { path: normalized.path }),
        ...(stars === undefined ? {} : { stars }),
        added: /^\d{4}-\d{2}-\d{2}$/.test(entry.added) ? entry.added : undefined,
      })
    } catch {
      // A bad registry entry cannot make the rest of the searchable catalog unusable.
    }
  }
  if (plugins.length === 0) throw new Error('Plugin catalog contains no installable entries')

  return {
    schemaVersion: 1,
    generatedAt: boundedText(generatedAt ?? value.generatedAt, 40),
    topic: PLUGIN_TOPIC_URL,
    registry: PLUGIN_REGISTRY_URL,
    source: boundedText(value.source, 500, 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin'),
    updated: boundedText(value.updated, 40),
    categories: catalogCategories(value.categories),
    count: plugins.length,
    plugins,
  }
}

export function readBundledPluginCatalog(path = join(import.meta.dirname, 'plugin-catalog.json')) {
  return normalizePluginCatalog(JSON.parse(readFileSync(path, 'utf8')))
}

/** Local extra entries (see plugin-catalog.extra.json) merged on top of any loaded catalog. */
export function readExtraPluginEntries(path = EXTRA_CATALOG_PATH) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const plugins = Array.isArray(parsed) ? parsed : parsed?.plugins
  if (!Array.isArray(plugins)) throw new Error('Invalid extra plugin catalog')
  return plugins
}

function catalogRepositoryKey(entry) {
  try {
    const url = new URL(normalizePluginSourceUrl(entry?.url))
    const segments = url.pathname.split('/').filter(Boolean)
    const normalized = installSpec(entry)
    return `${segments[0].toLowerCase()}/${segments[1].toLowerCase()}#${normalized.path ?? ''}`
  } catch {
    return undefined
  }
}

export function withLocalEntries(registry, extras) {
  const plugins = Array.isArray(registry?.plugins) ? registry.plugins : []
  const localKeys = new Set(extras.map(catalogRepositoryKey).filter(key => key !== undefined))
  return {
    ...registry,
    plugins: [
      ...plugins.filter(entry => {
        const key = catalogRepositoryKey(entry)
        return key === undefined || !localKeys.has(key)
      }),
      ...extras,
    ],
  }
}

export async function loadPluginCatalog({
  fetchImpl = globalThis.fetch,
  bundledPath,
  extraPath,
  signal,
  timeoutMs = 10_000,
} = {}) {
  const fallback = readBundledPluginCatalog(bundledPath)
  // Local extra entries (e.g. plugins not yet collected by the upstream
  // registry) are merged on top of whatever catalog loads, online or bundled.
  let extras = []
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new Error('Plugin catalog request timed out')), timeoutMs)
  timer.unref?.()
  try {
    extras = readExtraPluginEntries(extraPath)
    const response = await fetchImpl(PLUGIN_REGISTRY_URL, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-desktop-plugin-catalog' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Plugin catalog request failed (${String(response.status)})`)
    const contentLength = Number(response.headers?.get?.('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_PLUGIN_CATALOG_BYTES) {
      throw new Error('Plugin catalog response is too large')
    }
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_PLUGIN_CATALOG_BYTES) throw new Error('Plugin catalog response is too large')
    return {
      catalog: normalizePluginCatalog(withLocalEntries(JSON.parse(text), extras)),
      online: true,
      local: extras.length,
    }
  } catch (error) {
    return {
      catalog: normalizePluginCatalog(withLocalEntries(fallback, extras)),
      online: false,
      error: error instanceof Error ? error.message : String(error),
      local: extras.length,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
