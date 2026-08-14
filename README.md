# DSH Desktop

[简体中文](README.zh-CN.md) | English

An independent, open-source desktop wrapper for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It starts the bundled `@deepseek-ai/dsh` Web UI locally and loads it in a hardened Electron window on Linux, macOS, and Windows.

> DeepSeek Harness is currently a developer preview and may introduce breaking changes. DSH Desktop pins a tested Harness version so releases remain reproducible.

## Highlights

- No separate Node.js, npm, or `npx` installation is required for release builds.
- Uses a random free loopback port instead of assuming port `3080` is available.
- Starts and stops the Harness server together with the desktop application.
- Keeps Electron's Node integration disabled and blocks untrusted in-app navigation.
- Includes native installers and portable packages built by GitHub Actions.
- Supports both Intel and Apple Silicon macOS systems.

## Download

Download the latest package from [GitHub Releases](https://github.com/liguobao/dsh-desktop/releases):

| Platform | Package |
| --- | --- |
| Windows x64 | NSIS installer `.exe` or portable `.exe` |
| macOS Apple Silicon | `.dmg` or `.zip` with `arm64` in the name |
| macOS Intel | `.dmg` or `.zip` with `x64` in the name |
| Linux x64 | `.AppImage` or `.deb` |

The community CI builds are currently unsigned. Windows SmartScreen and macOS Gatekeeper may therefore show a warning. Review the release source and workflow before choosing to continue. On macOS, prefer the standard **Control-click → Open** flow instead of disabling Gatekeeper globally.

If macOS still reports that the app is damaged or cannot verify its developer, first move it to `/Applications` and confirm that the package came from this repository's GitHub Release. Then open Terminal and remove the quarantine attribute from DSH Desktop only:

```bash
xattr -dr com.apple.quarantine "/Applications/DSH Desktop.app"
```

For an AppImage:

```bash
chmod +x DSH-Desktop-*.AppImage
./DSH-Desktop-*.AppImage
```

## Use

1. Start DSH Desktop and wait for the local Harness service to become ready.
2. Open **Settings → Models** and configure your DeepSeek API key or another supported provider.
3. Choose or add a workspace.
4. Start a session.

See the upstream [Web UI guide](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart) for the Harness workflow.

The **View → Restart Harness** command restarts the local service. Diagnostic output is available through **Help → Open Logs Folder**.

## How it works

```text
DSH Desktop
├─ Electron main process
│  └─ bundled Electron runtime in Node mode
│     └─ @deepseek-ai/dsh web --port 0
└─ sandboxed Chromium window
   └─ http://127.0.0.1:<assigned-port>
```

The readiness URL is read from the official `dsh web` output. Only that exact loopback origin is allowed to remain inside the app; regular HTTP and HTTPS links open in the system browser. Closing the app terminates the local Harness process tree.

## Development

Requirements:

- Node.js 22 or newer
- npm 10 or newer

```bash
git clone https://github.com/liguobao/dsh-desktop.git
cd dsh-desktop
npm ci
npm start
```

Useful commands:

```bash
npm test           # unit tests
npm run check      # JavaScript syntax checks
npm run dist:linux
npm run dist:mac
npm run dist:windows
```

Cross-platform Electron installers should be produced on their target operating system. The repository workflow does this automatically.

## Releases

Pushing a semantic version tag builds all supported packages and creates a GitHub Release:

```bash
npm version 0.1.1 --no-git-tag-version
git commit -am "release: v0.1.1"
git tag -a v0.1.1 -m "DSH Desktop v0.1.1"
git push origin HEAD --follow-tags
```

The workflow intentionally does not contain signing identities. Maintainers can add Apple signing/notarization and Windows code-signing secrets later without changing the application architecture.

## Security

DeepSeek Harness is an agent harness that can read and modify selected workspace files and execute commands with the permissions you grant. Review the active workspace, model provider, and permission prompts before starting a task.

The HTTP server binds only to `127.0.0.1`. The desktop renderer has no Node.js access, no preload bridge, and no permission to navigate to a different origin inside the same window. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Project status and trademarks

This project is an independent community wrapper and is not an official DeepSeek product. DeepSeek and related names and marks belong to their respective owners.

DSH Desktop is available under the [MIT License](LICENSE). DeepSeek Harness is also distributed under the MIT License; see [NOTICE.md](NOTICE.md).
