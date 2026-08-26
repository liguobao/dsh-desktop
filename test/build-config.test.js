import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const buildWorkflow = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const readmeZh = readFileSync(new URL('../README.zh-CN.md', import.meta.url), 'utf8')

test('Windows build produces installer and portable packages', () => {
  assert.deepEqual(packageJson.build.win.target, ['nsis', 'portable'])
  assert.equal(packageJson.build.nsis.artifactName, 'DSH-Desktop-v${version}-windows-${arch}-setup.${ext}')
  assert.equal(packageJson.build.portable.artifactName, 'DSH-Desktop-v${version}-windows-${arch}-portable.${ext}')
  assert.notEqual(packageJson.build.nsis.artifactName, packageJson.build.portable.artifactName)
})

test('release builds bundle pnpm for profile plugin management', () => {
  assert.match(packageJson.dependencies.pnpm, /^\d+\.\d+\.\d+$/)
})

test('release builds bundle the prebuilt remote plugin and its runtime dependency tree', () => {
  assert.equal(packageJson.dependencies['ds-harness-remote'], 'github:liguobao/deepseek-harness-remote#v0.3.33')
  assert.equal(existsSync(new URL('../node_modules/ds-harness-remote/packages/plugin/dist/index.js', import.meta.url)), true)
  const client = readFileSync(new URL('../node_modules/ds-harness-remote/packages/plugin/dist/client.github.js', import.meta.url), 'utf8')
  assert.match(client, /name:\s*"settings\.plugin\.item",\s*key:\s*"ds-harness-remote"/)
})

test('release notes and download docs include the mirror and remote Android APK', () => {
  const mirror = 'https://pan.quark.cn/s/a837649635e2#/list/share/b4cc08109f3d47f78bc816ef2dbecd4f'
  assert.match(buildWorkflow, /Download bundled DSH Remote Android APK/)
  assert.match(buildWorkflow, /dsh-remote-android-\$\{remote_tag\}\.apk/)
  assert.match(buildWorkflow, /Desktop installers and the bundled DSH Remote Android client/)
  assert.match(buildWorkflow, /桌面安装包和内置版本匹配的 DSH Remote Android 客户端已附在本 Release/)
  assert.equal(buildWorkflow.includes(mirror), true)
  assert.match(readme, /DSH Remote Android client/)
  assert.match(readme, /dsh-remote-android-vA\.B\.C\.apk/)
  assert.equal(readme.includes(mirror), true)
  assert.match(readmeZh, /DSH Remote Android 客户端/)
  assert.match(readmeZh, /dsh-remote-android-vA\.B\.C\.apk/)
  assert.equal(readmeZh.includes(mirror), true)
})

test('release builds bundle the prebuilt file viewer plugin and its runtime dependency tree', () => {
  assert.equal(packageJson.dependencies['dsh-file-viewer'], 'github:liguobao/dsh-file-viewer#v0.2.4')
  assert.equal(existsSync(new URL('../node_modules/dsh-file-viewer/dist/index.js', import.meta.url)), true)
  assert.equal(existsSync(new URL('../node_modules/dsh-file-viewer/dist/client.js', import.meta.url)), true)
  assert.equal(existsSync(new URL('../node_modules/dsh-file-viewer/cordis.patch.yml', import.meta.url)), true)
})

test('release builds bundle the prebuilt Codex subagent plugin', () => {
  assert.equal(packageJson.dependencies['@deepseek-ai/dsh-subagent-codex'], '0.1.1-rc.2')
  assert.equal(packageJson.dependencies['@openai/codex'], undefined)
  assert.equal(existsSync(new URL('../node_modules/@deepseek-ai/dsh-subagent-codex/lib/index.js', import.meta.url)), true)
  assert.equal(existsSync(new URL('../node_modules/@deepseek-ai/dsh-subagent-codex/cordis.patch.yml', import.meta.url)), true)
  assert.equal(existsSync(new URL('../node_modules/@openai/codex/bin/codex.js', import.meta.url)), true)
  assert.equal(existsSync(new URL(`../node_modules/@openai/codex-${process.platform}-${process.arch}/package.json`, import.meta.url)), true)
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
