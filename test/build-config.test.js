import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('Windows build produces installer and portable packages', () => {
  assert.deepEqual(packageJson.build.win.target, ['nsis', 'portable'])
  assert.equal(packageJson.build.nsis.artifactName, 'DSH-Desktop-v${version}-windows-${arch}-setup.${ext}')
  assert.equal(packageJson.build.portable.artifactName, 'DSH-Desktop-v${version}-windows-${arch}-portable.${ext}')
  assert.notEqual(packageJson.build.nsis.artifactName, packageJson.build.portable.artifactName)
})
