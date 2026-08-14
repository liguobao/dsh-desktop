# DSH Desktop

[简体中文](README.zh-CN.md) | English

An independent, open-source desktop wrapper for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It starts the bundled `@deepseek-ai/dsh` Web UI locally and loads it in a hardened Electron window on Linux, macOS, and Windows.

> DeepSeek Harness is currently a developer preview and may introduce breaking changes. DSH Desktop pins a tested Harness version so releases remain reproducible.

## Highlights

- No separate Node.js, npm, or `npx` installation is required for release builds.
- Uses a random free loopback port instead of assuming port `3080` is available.
- Shows immediate, stage-based startup progress while the local Harness becomes ready.
- Starts and stops the Harness server together with the desktop application.
- Manages web-profile plugins from npm or pinned GitHub revisions, plus Skills-based user extensions, in separate desktop windows.
- Opens conversation files in VS Code, Cursor, VSCodium, or Zed, with workspace actions in the sidebar, session header, and native menu.
- Keeps Electron's Node integration disabled and blocks untrusted in-app navigation.
- Includes native installers and portable packages built by GitHub Actions.
- Supports both Intel and Apple Silicon macOS systems.

## Download

Download the latest package from [GitHub Releases](https://github.com/liguobao/dsh-desktop/releases):

| Platform | Package |
| --- | --- |
| Windows x64 installer | `DSH-Desktop-vX.Y.Z-windows-x64-setup.exe` |
| Windows x64 portable | `DSH-Desktop-vX.Y.Z-windows-x64-portable.exe` |
| macOS Apple Silicon | `DSH-Desktop-vX.Y.Z-macos-arm64.dmg` |
| macOS Intel | `DSH-Desktop-vX.Y.Z-macos-x64.dmg` |
| Linux x64 | `DSH-Desktop-vX.Y.Z-linux-x64.AppImage` |

Each release provides both installer and portable editions for Windows. Other platforms provide one recommended package per architecture; archive and alternative Linux formats are not published.

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

Clicking a code or text file in a conversation opens it in the detected editor. HTML, images, PDFs, and directories continue to use their system-default application. Each workspace's sidebar **…** menu offers **Open in Editor** and **Open Folder**; the VS Code icon in the session header also opens the current workspace in the preferred editor. Select VS Code, Cursor, VSCodium, or Zed through the native **Workspace → Preferred Editor** menu. Files fall back to the system-default application when no supported editor is detected; an explicit editor action reports an error instead.

The **Extensions** menu at the top of the window provides separate **Plugins** and **Skills** commands. Each opens its own window, and both windows can remain open together. The plugin window manages the `web` profile. It accepts an npm registry package such as `@scope/dsh-plugin` or `package@version`, and a public GitHub source in either `github:owner/repository#tag-or-commit` or `https://github.com/owner/repository.git#tag-or-commit` form. A GitHub revision is mandatory, and DSH Desktop saves the commit resolved by pnpm so later installs remain repeatable; GitHub installation also requires `git` to be available on `PATH`. Installed DSH bundles can be enabled, disabled, or uninstalled, while system bundles remain read-only. Restart Harness from the page when prompted. pnpm is bundled with the app.

GitHub dependency scripts are suppressed during the initial inspection install. If a repository needs install or build scripts, the page offers an explicit opt-in; review the exact pinned revision before enabling it. Plugins execute local code with the same operating-system permissions as Harness. DSH Desktop cannot establish that a third-party package is safe—review the publisher, source, and dependency tree before installing it.

The extension window manages the official `$DSH_HOME/skills` user directory. It can create a valid `SKILL.md` template, import a local folder containing `SKILL.md` and its resources, reveal an entry in the file manager, enable or disable it, and move it to the system Trash. Imported folders are validated against the Harness frontmatter format; symbolic links and oversized imports are rejected. Disabling an extension moves it to DSH Desktop's `$DSH_HOME/.disabled-skills` holding directory. Harness watches the active directory, so extension changes do not require a restart.

The **View → Restart Harness** command restarts the local service. Diagnostic output is available through **Help → Open Logs Folder**.

## How it works

```text
DSH Desktop
├─ Electron main process
│  ├─ restricted native path-opening bridge
│  ├─ plugin profile service + bundled pnpm
│  ├─ user Skill filesystem manager
│  └─ bundled Electron runtime in Node mode
│     └─ @deepseek-ai/dsh web --patch <desktop-adapter> --port 0
├─ sandboxed Harness window
│  └─ http://127.0.0.1:<assigned-port>
├─ sandboxed local plugin-manager window
│  └─ $DSH_HOME/profiles/web/package.json
└─ sandboxed local extension-manager window
   └─ $DSH_HOME/skills
```

Desktop capabilities come from the standalone dual-face `@dsh-desktop/integration` package in this repository. At startup, the app copies only that package into the upstream `$DSH_HOME/profiles/node_modules` extension-resolution directory and loads it with a one-off `--patch`. It does not modify the `@deepseek-ai/dsh` CLI source, installation, or the user's `cordis.patch.yml`.

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

The HTTP server binds only to `127.0.0.1`. Renderers have no Node.js access and cannot navigate outside their assigned origin or local page. The Harness preload accepts only workspace-scope and authorized path-opening messages from the exact Harness origin. Plugin and extension windows use different preloads and exact local-page checks, exposing only their respective fixed plugin or Skill operations; package-manager commands use argument arrays rather than a shell. Skill mutations are restricted to direct entries in the two app-managed roots, and imports reject symbolic links. The main process rejects paths and symlink escapes outside registered workspaces. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Project status and trademarks

This project is an independent community wrapper and is not an official DeepSeek product. DeepSeek and related names and marks belong to their respective owners.

DSH Desktop is available under the [MIT License](LICENSE). DeepSeek Harness is also distributed under the MIT License; see [NOTICE.md](NOTICE.md).
