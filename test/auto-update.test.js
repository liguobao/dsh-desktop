import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  LATEST_RELEASE_API_URL,
  RELEASES_URL,
  createInstallerUpdateController,
  downloadInstallerAsset,
  installerAssetName,
  parseLatestRelease,
  supportsInstallerDownloads,
} from '../src/auto-update.js'

const DIGEST = `sha256:${'a'.repeat(64)}`

function releaseFixture(version = '1.0.0', overrides = {}) {
  const name = installerAssetName({ version, platform: 'linux', arch: 'x64' })
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [{
      name,
      state: 'uploaded',
      size: 123,
      digest: DIGEST,
      browser_download_url: `https://github.com/liguobao/dsh-desktop/releases/download/v${version}/${name}`,
    }],
    ...overrides,
  }
}

function fixture(overrides = {}) {
  const messages = []
  const responses = [...(overrides.responses ?? [])]
  const openedReleases = []
  const openedFiles = []
  const downloads = []
  const progress = []
  const release = overrides.release ?? releaseFixture()
  const controller = createInstallerUpdateController({
    isPackaged: true,
    platform: 'linux',
    arch: 'x64',
    isChinese: false,
    currentVersion: '1.0.0',
    downloadsDirectory: '/Downloads',
    fetchImpl: overrides.fetchImpl ?? (async url => {
      assert.equal(url, LATEST_RELEASE_API_URL)
      return new Response(JSON.stringify(release), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
    dialog: {
      async showMessageBox(options) {
        messages.push(options)
        return { response: responses.shift() ?? 1 }
      },
    },
    getWindow: () => undefined,
    openReleasePage: async url => { openedReleases.push(url) },
    openDownloadedFile: async path => { openedFiles.push(path) },
    downloadImpl: overrides.downloadImpl ?? (async options => {
      downloads.push(options)
      options.onProgress(42)
      progress.push(42)
      return `/Downloads/${options.asset.name}`
    }),
    log: overrides.log,
    ...overrides.controller,
  })
  return { controller, downloads, messages, openedFiles, openedReleases, progress }
}

test('installer assets map to the packages published for each platform and architecture', () => {
  assert.equal(installerAssetName({ version: '1.2.3', platform: 'darwin', arch: 'arm64' }), 'DSH-Desktop-v1.2.3-macos-arm64.dmg')
  assert.equal(installerAssetName({ version: '1.2.3', platform: 'darwin', arch: 'x64' }), 'DSH-Desktop-v1.2.3-macos-x64.dmg')
  assert.equal(installerAssetName({ version: '1.2.3', platform: 'win32', arch: 'x64' }), 'DSH-Desktop-v1.2.3-windows-x64-setup.exe')
  assert.equal(installerAssetName({ version: '1.2.3', platform: 'linux', arch: 'x64' }), 'DSH-Desktop-v1.2.3-linux-x64.AppImage')
  assert.equal(supportsInstallerDownloads({ isPackaged: true, platform: 'win32', arch: 'arm64' }), false)
  assert.equal(supportsInstallerDownloads({ isPackaged: false, platform: 'darwin', arch: 'arm64' }), false)
})
test('latest Release parsing requires the exact installer and GitHub SHA-256 metadata', () => {
  const parsed = parseLatestRelease(releaseFixture('1.2.3'), { platform: 'linux', arch: 'x64' })
  assert.equal(parsed.version, '1.2.3')
  assert.equal(parsed.asset.digest, DIGEST)

  const missingDigest = releaseFixture('1.2.3')
  missingDigest.assets[0].digest = null
  assert.throws(() => parseLatestRelease(missingDigest, { platform: 'linux', arch: 'x64' }), /SHA-256/)

  const untrusted = releaseFixture('1.2.3')
  untrusted.assets[0].browser_download_url = `https://example.com/${untrusted.assets[0].name}`
  assert.throws(() => parseLatestRelease(untrusted, { platform: 'linux', arch: 'x64' }), /not trusted/)
})

test('unsupported builds open the latest GitHub Release from the menu', async () => {
  const setup = fixture({ controller: { isPackaged: false } })

  assert.equal(setup.controller.initialize(), false)
  assert.equal(setup.controller.menuItem().label, 'View Latest Release…')
  await setup.controller.check(true)

  assert.deepEqual(setup.openedReleases, [RELEASES_URL])
})

test('a manual check reports when the installed version is current', async () => {
  const setup = fixture()
  assert.equal(setup.controller.initialize(), true)

  await setup.controller.check(true)

  assert.equal(setup.controller.state, 'idle')
  assert.equal(setup.messages.at(-1).title, 'You’re Up to Date')
  assert.equal(setup.downloads.length, 0)
})

test('an available update downloads the installer and opens the local file after confirmation', async () => {
  const setup = fixture({ release: releaseFixture('1.1.0'), responses: [0, 0] })

  await setup.controller.check(false)

  assert.equal(setup.messages[0].title, 'Update Available')
  assert.equal(setup.messages[1].title, 'Installer Downloaded')
  assert.equal(setup.downloads.length, 1)
  assert.equal(setup.downloads[0].asset.name, 'DSH-Desktop-v1.1.0-linux-x64.AppImage')
  assert.deepEqual(setup.openedFiles, ['/Downloads/DSH-Desktop-v1.1.0-linux-x64.AppImage'])
  assert.equal(setup.controller.state, 'downloaded')
  assert.equal(setup.controller.menuItem().label, 'Show Downloaded AppImage…')
})

test('background Release check errors are logged without interrupting the user', async () => {
  const logs = []
  const setup = fixture({
    fetchImpl: async () => { throw new Error('offline') },
    log: (level, message) => logs.push({ level, message }),
  })

  await setup.controller.check(false)

  assert.equal(setup.controller.state, 'idle')
  assert.equal(setup.messages.length, 0)
  assert.match(logs.at(-1).message, /offline/)
})

test('installer download streams to a collision-free file and verifies its digest', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-installer-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const data = Buffer.from('verified installer data')
  const name = 'DSH-Desktop-v1.2.3-macos-arm64.dmg'
  writeFileSync(join(directory, name), 'existing file')
  const progress = []

  const path = await downloadInstallerAsset({
    asset: {
      name,
      size: data.length,
      digest: `sha256:${createHash('sha256').update(data).digest('hex')}`,
      url: 'https://github.com/liguobao/dsh-desktop/releases/download/v1.2.3/test.dmg',
    },
    downloadsDirectory: directory,
    fetchImpl: async () => new Response(data),
    platform: 'darwin',
    onProgress: value => progress.push(value),
  })

  assert.equal(path, join(directory, 'DSH-Desktop-v1.2.3-macos-arm64 (1).dmg'))
  assert.deepEqual(readFileSync(path), data)
  assert.equal(readFileSync(join(directory, name), 'utf8'), 'existing file')
  assert.equal(progress.at(-1), 100)
})

test('installer download removes a file that fails SHA-256 verification', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-installer-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const data = Buffer.from('tampered installer')

  await assert.rejects(downloadInstallerAsset({
    asset: {
      name: 'DSH-Desktop-v1.2.3-windows-x64-setup.exe',
      size: data.length,
      digest: DIGEST,
      url: 'https://github.com/liguobao/dsh-desktop/releases/download/v1.2.3/test.exe',
    },
    downloadsDirectory: directory,
    fetchImpl: async () => new Response(data),
    platform: 'win32',
  }), /SHA-256/)

  assert.throws(() => readFileSync(join(directory, 'DSH-Desktop-v1.2.3-windows-x64-setup.exe')), /ENOENT/)
})
