#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_PLUGIN_CATALOG_BYTES,
  PLUGIN_REGISTRY_URL,
  PLUGIN_TOPIC_URL,
  normalizePluginCatalog,
  readExtraPluginEntries,
  withLocalEntries,
} from '../src/plugin-catalog.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const outputPath = resolve(process.argv[2] ?? 'src/plugin-catalog.json')
const extraPath = resolve(process.argv[3] ?? join(scriptDir, '..', 'src', 'plugin-catalog.extra.json'))
const headers = { 'user-agent': 'dsh-desktop-plugin-catalog-generator' }

async function download(url, accept) {
  const response = await fetch(url, { headers: { ...headers, accept }, redirect: 'error' })
  if (!response.ok) throw new Error(`${url} returned ${String(response.status)}`)
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_PLUGIN_CATALOG_BYTES) throw new Error(`${url} response is too large`)
  return text
}

const topicHtml = await download(PLUGIN_TOPIC_URL, 'text/html')
if (!topicHtml.includes('<title>dsh-plugin · GitHub Topics · GitHub')) {
  throw new Error('The dsh-plugin GitHub topic could not be verified')
}

const registryText = await download(PLUGIN_REGISTRY_URL, 'application/json')
const registry = JSON.parse(registryText)
const extraPlugins = readExtraPluginEntries(extraPath)
const catalog = normalizePluginCatalog(withLocalEntries(registry, extraPlugins), { generatedAt: new Date().toISOString() })
writeFileSync(outputPath, `${JSON.stringify(catalog, undefined, 2)}\n`)
console.log(`Wrote ${String(catalog.count)} installable plugins (${extraPlugins.length} local entries) to ${outputPath}`)
