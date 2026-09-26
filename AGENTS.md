# Repository instructions

## Known upstream defects we compensate for

Three defects live above this wrapper. Fix them here only as compensation, and delete the compensation once upstream ships a fix.

- **A launcher preload leaks into node-pty's own helpers.** node-pty starts its Windows ConPTY output worker and its forked console-list agent without an `execArgv` option, and Node defaults a worker's or forked child's `execArgv` to `process.execArgv`, so every `--require`/`--loader` flag the launcher put on the Harness is replayed inside those helpers. `src/parent-watch.cjs` installs a stdin watcher that SIGTERMs the process when stdin ends, and in a worker thread `process.stdin` is an already-ended stub — opening a terminal therefore killed the whole Harness with `exit code 1` and no stderr at all. The watcher is now gated to the Harness entry file, `test/parent-watch.test.js` asserts a preload-inheriting worker survives, and `scripts/patch-node-pty-windows.mjs` additionally pins `execArgv: []` on both helpers.
- **node-pty kills the Harness when a Windows terminal fails.** `node-pty`'s `WindowsPtyAgent` registers its ConPTY worker error handler before `_inSocket` exists and then destroys that socket unconditionally, so a failed worker becomes an uncaught `TypeError` that terminates the whole process (`exit code 1`). `npm install` would reinstall the upstream file, so `scripts/patch-node-pty-windows.mjs` runs from `postinstall`, and `test/node-pty-patch.test.js` asserts both the patched tree and the guard's exact-byte contract, failing loudly when node-pty changes shape.
- **Stale Host session cookies stall the browser boot.** The Host names its browser-session cookie `dsh-auth-<sha256(host:port)>` and gives it a multi-day `Max-Age`, so every Harness restart adds one more cookie for the same loopback origin instead of replacing one. Enough of them push the plugin-bundle request line past the Host's header budget, the request answers `431`, and the renderer stays on "Failed to load plugins" until that origin's cookies are cleared. `src/browser-session.js` prunes all but the newest auth cookie per loopback host right before the Harness URL loads; `test/browser-session.test.js` covers the selection rules, failure containment, and the timeout bound.

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


## Bundled components

- `dsh-file-viewer` is intentionally removed and must not be reintroduced as a bundled dependency or startup plugin.
