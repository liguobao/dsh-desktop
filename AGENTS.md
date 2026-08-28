# Repository instructions

## Release notes

- Whenever creating or updating a GitHub Release description or another release log, include the mainland China download mirror in both English and Chinese.
- Use this exact link: [Quark Cloud Drive / 夸克网盘](https://pan.quark.cn/s/a837649635e2#/list/share/b4cc08109f3d47f78bc816ef2dbecd4f).
- Keep the automated Release notes in `.github/workflows/build.yml` consistent with the download sections in `README.md` and `README.zh-CN.md`.

## Desktop runtime commands and PATH

- Treat every packaged desktop process as if it was launched from Finder or Explorer with no login-shell environment. Never assume that `npm`, `pnpm`, `node`, or another user-installed executable is available on `PATH`, even when the same command works in a development terminal.
- App-owned Node.js and package operations must use the runtime and pnpm entry bundled with DSH Desktop. Invoke them through `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, `shell: false`, and explicit argument arrays; do not spawn a bare `node`, `npm`, or `pnpm` command.
- Do not use pnpm commands that delegate to a separately installed npm executable, including `pnpm view` and `pnpm info`. Fetch npm registry metadata through the desktop network layer using the registry configured for pnpm, then use bundled pnpm only for package mutations.
- Do not fix GUI-versus-terminal environment failures by guessing shell installation paths or copying a developer machine's `PATH`. If a genuinely external tool is required, detect it explicitly and return an actionable error; otherwise bundle the dependency or replace the CLI call with an in-process API.
- Any change that launches a process or checks package updates must include a regression test with a minimal GUI-style `PATH` where `npm`, user-installed Node.js, and user-installed pnpm are unavailable. Tests must prove that app-owned workflows still use bundled tools and do not fall through to system package managers.
