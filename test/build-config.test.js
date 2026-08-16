import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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

test('macOS DMG ships the install notes with the copyable quarantine command', () => {
  const contents = packageJson.build.dmg.contents
  assert.ok(Array.isArray(contents), 'dmg.contents should be configured')
  const notes = contents.find((item) => item.name === '安装说明.txt')
  assert.ok(notes, 'DMG contents should include 安装说明.txt')
  assert.equal(notes.type, 'file')
  assert.equal(notes.path, 'build/macos-install-notes.txt')
  assert.ok(
    contents.some((item) => item.type === 'link' && item.path === '/Applications'),
    'DMG should keep the /Applications link'
  )
  assert.ok(
    contents.some((item) => item.path == null),
    'DMG should keep the app entry (path omitted, defaults to the built app)'
  )
})

test('macOS install notes contain the xattr quarantine command', () => {
  const notesUrl = new URL('../build/macos-install-notes.txt', import.meta.url)
  assert.equal(existsSync(notesUrl), true)
  const text = readFileSync(notesUrl, 'utf8')
  assert.match(text, /xattr -dr com\.apple\.quarantine "\/Applications\/DSH Desktop\.app"/)
  assert.match(text, /Gatekeeper/)
})
