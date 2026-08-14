import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { parse, stringify } from 'yaml'

export const MAX_SKILL_FILE_BYTES = 1024 * 1024
export const MAX_SKILL_IMPORT_BYTES = 25 * 1024 * 1024
export const MAX_SKILL_IMPORT_FILES = 512
export const MAX_SKILL_IMPORT_ENTRIES = 1024

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function skillDirectories(dshHome) {
  return {
    activeDir: join(dshHome, 'skills'),
    disabledDir: join(dshHome, '.disabled-skills'),
  }
}

function normalizeEntry(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160) throw new Error('Invalid skill entry')
  if (value === '.' || value === '..' || value.startsWith('.') || value.includes('/') || value.includes('\\')) {
    throw new Error('Invalid skill entry')
  }
  if (basename(value) !== value || value.includes('\0') || /[\r\n]/.test(value)) throw new Error('Invalid skill entry')
  return value
}

function parseBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    if (['true', 'yes', 'on'].includes(value.toLowerCase())) return true
    if (['false', 'no', 'off'].includes(value.toLowerCase())) return false
  }
  throw new Error(`frontmatter field "${key}" must be a boolean`)
}

function parseFrontmatter(raw) {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') {
    throw new Error('missing YAML frontmatter')
  }
  let lineStart = firstLineEnd + 1
  let closingStart
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      closingStart = lineStart
      break
    }
    if (nextNewline < 0) break
    lineStart = nextNewline + 1
  }
  if (closingStart === undefined) throw new Error('missing YAML frontmatter')
  const data = parse(raw.slice(firstLineEnd + 1, closingStart))
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('frontmatter must be a YAML object')
  if (typeof data.name !== 'string' || !SKILL_NAME_PATTERN.test(data.name)) throw new Error('name must be kebab-case')
  if (typeof data.description !== 'string' || data.description.trim() === '') throw new Error('description is required')
  for (const legacy of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    if (Object.hasOwn(data, legacy)) throw new Error(`unsupported frontmatter field "${legacy}"`)
  }
  const disableModelInvocation = parseBoolean(data, 'disable-model-invocation')
  const userInvocable = parseBoolean(data, 'user-invocable')
  return {
    name: data.name,
    description: data.description,
    whenToUse: typeof data.whenToUse === 'string' && data.whenToUse.length > 0 ? data.whenToUse : undefined,
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

function skillFileForEntry(root, entry) {
  const path = join(root, entry)
  const stats = lstatSync(path)
  if (stats.isSymbolicLink()) throw new Error('symbolic-link skills are not managed by DSH Desktop')
  if (stats.isDirectory()) {
    const skillFile = join(path, 'SKILL.md')
    const skillStats = lstatSync(skillFile)
    if (!skillStats.isFile() || skillStats.isSymbolicLink()) throw new Error('SKILL.md must be a regular file')
    return { path, skillFile, format: 'bundle', size: skillStats.size }
  }
  if (stats.isFile() && entry.endsWith('.md')) return { path, skillFile: path, format: 'file', size: stats.size }
  throw new Error('entry is not a supported skill')
}

function inspectSkill(root, entry, enabled) {
  const fallbackName = entry.endsWith('.md') ? entry.slice(0, -3) : entry
  try {
    const located = skillFileForEntry(root, entry)
    if (located.size > MAX_SKILL_FILE_BYTES) throw new Error('SKILL.md is too large')
    const parsed = parseFrontmatter(readFileSync(located.skillFile, 'utf8'))
    return { entry, enabled, valid: true, ...located, ...parsed }
  } catch (error) {
    return {
      entry,
      enabled,
      valid: false,
      name: fallbackName,
      description: '',
      path: join(root, entry),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function listRoot(root, enabled) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.') && (entry.isDirectory() || (entry.isFile() && entry.name.endsWith('.md')) || entry.isSymbolicLink()))
    .map(entry => inspectSkill(root, entry.name, enabled))
}

export function readSkillCatalog({ dshHome }) {
  const { activeDir, disabledDir } = skillDirectories(dshHome)
  const skills = [...listRoot(activeDir, true), ...listRoot(disabledDir, false)]
    .sort((left, right) => left.name.localeCompare(right.name) || Number(right.enabled) - Number(left.enabled))
  return { activeDir, disabledDir, skills }
}

function assertAvailable(directories, name) {
  const entries = [name, `${name}.md`]
  for (const root of [directories.activeDir, directories.disabledDir]) {
    if (entries.some(entry => existsSync(join(root, entry)))) throw new Error(`A skill named "${name}" already exists`)
  }
  const duplicate = [...listRoot(directories.activeDir, true), ...listRoot(directories.disabledDir, false)]
    .some(skill => skill.valid && skill.name === name)
  if (duplicate) throw new Error(`A skill named "${name}" already exists`)
}

export function createSkill({ dshHome, name, description }) {
  if (typeof name !== 'string' || !SKILL_NAME_PATTERN.test(name)) throw new Error('Skill name must be kebab-case')
  if (typeof description !== 'string' || description.trim() === '') throw new Error('Skill description is required')
  const normalizedDescription = description.trim()
  if (normalizedDescription.length > 500) throw new Error('Skill description is too long')
  const directories = skillDirectories(dshHome)
  assertAvailable(directories, name)
  mkdirSync(directories.activeDir, { recursive: true, mode: 0o700 })
  const target = join(directories.activeDir, name)
  mkdirSync(target, { recursive: false, mode: 0o700 })
  try {
    const frontmatter = stringify({ name, description: normalizedDescription }).trimEnd()
    const title = name.split('-').map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
    writeFileSync(join(target, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# ${title}\n\nDescribe the workflow and instructions for this skill.\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    rmSync(target, { recursive: true, force: true })
    throw error
  }
  return readSkillCatalog({ dshHome })
}

function copySkillDirectory(source, target) {
  let entries = 0
  let files = 0
  let bytes = 0
  try {
    cpSync(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: path => {
        entries += 1
        if (entries > MAX_SKILL_IMPORT_ENTRIES) throw new Error('Skill import has too many entries')
        const stats = lstatSync(path)
        if (stats.isSymbolicLink()) throw new Error('Skill imports cannot contain symbolic links')
        if (!stats.isDirectory() && !stats.isFile()) throw new Error('Skill imports can contain only files and directories')
        if (stats.isFile()) {
          files += 1
          bytes += stats.size
          if (files > MAX_SKILL_IMPORT_FILES || bytes > MAX_SKILL_IMPORT_BYTES) throw new Error('Skill import is too large')
        }
        return true
      },
    })
  } catch (error) {
    rmSync(target, { recursive: true, force: true })
    throw error
  }
}

export function importSkill({ dshHome, sourcePath }) {
  if (typeof sourcePath !== 'string' || sourcePath.length === 0 || sourcePath.includes('\0')) throw new Error('Invalid skill folder')
  const sourceStats = lstatSync(sourcePath)
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) throw new Error('Choose a regular folder containing SKILL.md')
  const located = skillFileForEntry(join(sourcePath, '..'), basename(sourcePath))
  if (located.size > MAX_SKILL_FILE_BYTES) throw new Error('SKILL.md is too large')
  const parsed = parseFrontmatter(readFileSync(located.skillFile, 'utf8'))
  const directories = skillDirectories(dshHome)
  assertAvailable(directories, parsed.name)
  mkdirSync(directories.activeDir, { recursive: true, mode: 0o700 })
  const target = join(directories.activeDir, parsed.name)
  const staging = join(dshHome, `.skill-import-${String(process.pid)}-${String(Date.now())}`)
  if (existsSync(staging)) throw new Error('A Skill import is already being prepared')
  copySkillDirectory(sourcePath, staging)
  try {
    if (existsSync(target)) throw new Error(`A skill named "${parsed.name}" already exists`)
    renameSync(staging, target)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
  return readSkillCatalog({ dshHome })
}

export function setSkillEnabled({ dshHome, entry, enabled }) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid skill state')
  const normalizedEntry = normalizeEntry(entry)
  const directories = skillDirectories(dshHome)
  const sourceRoot = enabled ? directories.disabledDir : directories.activeDir
  const targetRoot = enabled ? directories.activeDir : directories.disabledDir
  const located = skillFileForEntry(sourceRoot, normalizedEntry)
  if (located.size > MAX_SKILL_FILE_BYTES) throw new Error('SKILL.md is too large')
  const parsed = parseFrontmatter(readFileSync(located.skillFile, 'utf8'))
  const duplicate = listRoot(targetRoot, enabled).some(skill => skill.valid && skill.name === parsed.name)
  if (duplicate) throw new Error(`A skill named "${parsed.name}" already exists in the target state`)
  mkdirSync(targetRoot, { recursive: true, mode: 0o700 })
  const target = join(targetRoot, normalizedEntry)
  if (existsSync(target)) throw new Error('A skill with the same entry already exists in the target state')
  renameSync(located.path, target)
  return readSkillCatalog({ dshHome })
}

export function resolveManagedSkillPath({ dshHome, entry, enabled }) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid skill state')
  const normalizedEntry = normalizeEntry(entry)
  const directories = skillDirectories(dshHome)
  const root = enabled ? directories.activeDir : directories.disabledDir
  const path = join(root, normalizedEntry)
  lstatSync(path)
  return path
}
