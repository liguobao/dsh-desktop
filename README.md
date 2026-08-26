# DSH Desktop

[简体中文](README.zh-CN.md) | English

An independent, open-source desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It bundles a tested Harness version and runs it locally in a hardened Electron window on Windows, macOS, and Linux.

> DSH Desktop is a community project, not an official DeepSeek product. DeepSeek Harness is currently a developer preview and may introduce breaking changes.

## Features

- Ready-to-use packages with no separate Node.js, npm, or `npx` setup.
- Bundled, version-matched DeepSeek Harness, Remote, File Viewer, and Codex Subagent components.
- Read-only previews for source code, text, Markdown, images, PDFs, CSV, JSON, and YAML.
- Remote session access from another authorized computer, phone, tablet, or browser.
- Delegate isolated tasks to Codex through the built-in `subagent_codex` tool.
- Plugin discovery and installation from npm or GitHub.
- Workspace actions for VS Code, Cursor, VSCodium, Zed, and the system file manager.
- Local-only Harness service, restricted Electron renderers, and external links opened in the system browser.
- Built-in update checks for new DSH Desktop releases with SHA-256 verification.

## Download

Download the latest version from [GitHub Releases](https://github.com/liguobao/dsh-desktop/releases).

For downloads in mainland China, use [Quark Cloud Drive / 夸克网盘](https://pan.quark.cn/s/a837649635e2#/list/share/b4cc08109f3d47f78bc816ef2dbecd4f).

| Platform | Package |
| --- | --- |
| Windows x64 installer | `DSH-Desktop-vX.Y.Z-windows-x64-setup.exe` |
| Windows x64 portable | `DSH-Desktop-vX.Y.Z-windows-x64-portable.exe` |
| macOS Apple Silicon | `DSH-Desktop-vX.Y.Z-macos-arm64.dmg` |
| macOS Intel | `DSH-Desktop-vX.Y.Z-macos-x64.dmg` |
| Linux x64 | `DSH-Desktop-vX.Y.Z-linux-x64.AppImage` |
| DSH Remote Android client | `dsh-remote-android-vA.B.C.apk` |

The Android client APK version follows the bundled Remote component. macOS packages are Developer ID signed and notarized. Windows may still show a SmartScreen warning. Only install packages downloaded from this repository's Release page or the mirror above.

To run the AppImage:

```bash
chmod +x DSH-Desktop-*.AppImage
./DSH-Desktop-*.AppImage
```

## Quick start

1. Open DSH Desktop and wait for Harness to start.
2. Go to **Settings → Models** and configure a DeepSeek API key or another supported provider.
3. Add or select a workspace.
4. Start a session.

See the upstream [Harness Web UI guide](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart) for model, workspace, and session usage.

Use the **Plugins** menu to browse or manage plugins. Plugins run with the same local permissions as Harness, so install only sources you trust. Restart Harness after changing plugins.

DSH Desktop checks GitHub Releases for updates. After downloading and verifying the matching installer, it lets you open the package and exits so the system installer can finish the update. DeepSeek Harness and the bundled components update together with DSH Desktop.

## Development

Requires Node.js 22 or newer and npm 10 or newer.

```bash
git clone https://github.com/liguobao/dsh-desktop.git
cd dsh-desktop
npm ci
npm start
```

```bash
npm test
npm run check
npm run dist:linux
npm run dist:mac
npm run dist:windows
```

Installers should be built on their target operating system. GitHub Actions builds all supported platforms when a matching `vX.Y.Z` tag is pushed.

## Security and license

Harness can read and modify files in selected workspaces and execute commands with the permissions you grant. Review the active workspace, model provider, installed plugins, and permission prompts before starting a task. See [SECURITY.md](SECURITY.md) for security details and vulnerability reporting.

DSH Desktop is available under the [MIT License](LICENSE). Third-party notices are listed in [NOTICE.md](NOTICE.md).
