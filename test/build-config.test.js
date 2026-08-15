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

test('release builds bundle pnpm for profile plugin management', () => {
  assert.match(packageJson.dependencies.pnpm, /^\d+\.\d+\.\d+$/)
})

test('release builds publish only user-facing installers', () => {
  assert.equal(packageJson.build.publish, undefined)
  assert.deepEqual(packageJson.build.mac.target, ['dmg'])
  assert.match(packageJson.scripts['dist:mac'], /--mac dmg --publish/)
  assert.equal(packageJson.build.mac.artifactName, 'DSH-Desktop-v${version}-macos-${arch}.${ext}')
  assert.equal(packageJson.dependencies['electron-updater'], undefined)
})
