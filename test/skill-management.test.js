import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createSkill,
  importSkill,
  readSkillCatalog,
  resolveManagedSkillPath,
  setSkillEnabled,
} from '../src/skill-management.js'

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-skill-manager-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function writeSkill(directory, name, extra = '') {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Test ${name}\n${extra}---\n\n# Instructions\n`)
}

test('creates an official user Skill template and reads invocation metadata', (t) => {
  const dshHome = temporaryDirectory(t)
  let catalog = createSkill({ dshHome, name: 'review-code', description: 'Review code changes carefully' })
  assert.equal(catalog.skills.length, 1)
  assert.deepEqual(catalog.skills[0], {
    entry: 'review-code',
    enabled: true,
    valid: true,
    path: join(dshHome, 'skills', 'review-code'),
    skillFile: join(dshHome, 'skills', 'review-code', 'SKILL.md'),
    format: 'bundle',
    size: Buffer.byteLength(readFileSync(join(dshHome, 'skills', 'review-code', 'SKILL.md'))),
    name: 'review-code',
    description: 'Review code changes carefully',
    whenToUse: undefined,
    modelInvocable: true,
    userInvocable: true,
  })
  assert.match(readFileSync(catalog.skills[0].skillFile, 'utf8'), /^---\nname: review-code\n/)
  assert.throws(() => createSkill({ dshHome, name: 'ReviewCode', description: 'No' }), /kebab-case/)

  writeSkill(join(dshHome, 'skills', 'user-only'), 'user-only', 'disable-model-invocation: true\nuser-invocable: true\n')
  catalog = readSkillCatalog({ dshHome })
  const userOnly = catalog.skills.find(skill => skill.name === 'user-only')
  assert.equal(userOnly.modelInvocable, false)
  assert.equal(userOnly.userInvocable, true)
})

test('disables and re-enables Skills by moving only direct managed entries', (t) => {
  const dshHome = temporaryDirectory(t)
  createSkill({ dshHome, name: 'toggle-me', description: 'Toggle this Skill' })
  let catalog = setSkillEnabled({ dshHome, entry: 'toggle-me', enabled: false })
  assert.equal(catalog.skills[0].enabled, false)
  assert.equal(resolveManagedSkillPath({ dshHome, entry: 'toggle-me', enabled: false }), join(dshHome, '.disabled-skills', 'toggle-me'))
  catalog = setSkillEnabled({ dshHome, entry: 'toggle-me', enabled: true })
  assert.equal(catalog.skills[0].enabled, true)
  assert.throws(() => resolveManagedSkillPath({ dshHome, entry: '../outside', enabled: true }), /Invalid skill entry/)
})

test('imports a valid Skill bundle with resources and rejects symbolic links', (t) => {
  const root = temporaryDirectory(t)
  const dshHome = join(root, 'home')
  const source = join(root, 'downloaded-skill')
  writeSkill(source, 'imported-skill')
  mkdirSync(join(source, 'references'))
  writeFileSync(join(source, 'references', 'guide.md'), '# Guide\n')

  let catalog = importSkill({ dshHome, sourcePath: source })
  assert.equal(catalog.skills[0].name, 'imported-skill')
  assert.equal(readFileSync(join(dshHome, 'skills', 'imported-skill', 'references', 'guide.md'), 'utf8'), '# Guide\n')

  if (process.platform !== 'win32') {
    const unsafe = join(root, 'unsafe-skill')
    writeSkill(unsafe, 'unsafe-skill')
    symlinkSync(join(source, 'references', 'guide.md'), join(unsafe, 'linked.md'))
    assert.throws(() => importSkill({ dshHome, sourcePath: unsafe }), /symbolic links/)
  }
  assert.equal(readSkillCatalog({ dshHome }).skills.length, 1)
})

test('reports malformed user entries without exposing nested paths', (t) => {
  const dshHome = temporaryDirectory(t)
  const broken = join(dshHome, 'skills', 'broken')
  mkdirSync(broken, { recursive: true })
  writeFileSync(join(broken, 'SKILL.md'), '# Missing frontmatter\n')
  const catalog = readSkillCatalog({ dshHome })
  assert.equal(catalog.skills[0].valid, false)
  assert.match(catalog.skills[0].error, /frontmatter/)
})
