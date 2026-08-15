#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MAX_PLUGIN_CATALOG_BYTES,
  PLUGIN_REGISTRY_URL,
  PLUGIN_TOPIC_URL,
  normalizePluginCatalog,
} from '../src/plugin-catalog.js'

const outputPath = resolve(process.argv[2] ?? 'src/plugin-catalog.json')
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
const catalog = normalizePluginCatalog(JSON.parse(registryText), { generatedAt: new Date().toISOString() })
writeFileSync(outputPath, `${JSON.stringify(catalog, undefined, 2)}\n`)
console.log(`Wrote ${String(catalog.count)} installable plugins to ${outputPath}`)
