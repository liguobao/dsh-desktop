# PowerShell 沙箱控制台弹窗：根因分析与修复报告

## 结论

DSH Desktop 0.1.56 在 Windows 的“仅查看”和“工作区修改”权限下通过 `pwsh` 工具执行命令时，实际调用的是受限令牌 ACL 沙箱路径，而不是普通进程创建路径：

```text
dsh-tool-pwsh
  -> dsh-pwsh-sandbox
  -> dsh-sandbox-local / windows-acl
  -> AclSandbox.spawn({ stdio: "inherit" })
  -> spawnSandboxedInherited
  -> spawnInheritedJobProcess
  -> CreateProcessAsUserW(..., creationFlags = 4, ...)
```

`4` 仅为 `CREATE_SUSPENDED`。该路径没有设置 `CREATE_NO_WINDOW`，并且使用继承的标准输入输出启动控制台程序，因此在无控制台的 Electron / Harness 进程中会让 Windows 为 PowerShell 创建一个可见控制台窗口。

修复只针对受限令牌沙箱路径，将创建标志改为：

```js
const CREATE_NO_WINDOW = 0x08000000;

createRestrictedProcess(
  api,
  options,
  commandLine,
  4 | CREATE_NO_WINDOW,
  startupInfo,
  processInfo,
);
```

## 问题现象与影响范围

- **平台**：Windows。
- **权限模式**：`read-only`（仅查看）和 `workspace-write`（工作区修改）。
- **触发方式**：通过 DSH 的 `pwsh` 工具执行 PowerShell 命令。
- **表现**：执行期间弹出可见的 PowerShell 终端窗口。
- **对比**：切换为“完全权限”后不弹出窗口，因此问题并非所有 `pwsh` 调用共有，而是与受限权限路径有关。
- **安全边界**：修复只影响窗口显示，不应削弱 ACL、受限令牌、Job Object 或文件权限限制。

## 实际调用链与根因

### 受限权限路径

在 `@deepseek-ai/dsh-sandbox-windows-acl` 中，`stdio: "inherit"` 的沙箱调用最终进入 `spawnSandboxedInherited`，再由 `@deepseek-ai/dsh-win32-process` 的 `spawnInheritedJobProcess` 创建进程。

原实现为：

```js
return spawnJobProcess(
  api,
  options,
  () => inheritedStandardHandles(api),
  "CreateProcessAsUserW",
  (startupInfo, processInfo) =>
    createRestrictedProcess(api, options, commandLine, 4, startupInfo, processInfo),
);
```

这里使用 `CreateProcessAsUserW` 创建受限令牌进程，缺失 `CREATE_NO_WINDOW`。在宿主进程没有控制台的情况下，Windows 为这个控制台程序创建可见控制台，因此出现弹窗。

### 为什么完全权限不弹窗

“完全权限”走的是另一条路径：

```text
spawnCurrentTokenJobProcess
  -> CreateProcessW(..., 1028, ...)
```

该路径使用 fd carrier 的重定向 stdio，而不是 ACL 沙箱的继承 stdio；它也不会进入 `spawnInheritedJobProcess`。因此，修改普通 `CreateProcessW` 路径并不能修复仅查看和工作区修改模式下的弹窗。

### 上一轮定位为什么无效

上一轮修复做了两件事：

1. 在 `spawnCurrentTokenJobProcess` 的普通 `CreateProcessW` 调用上增加 `CREATE_NO_WINDOW`。
2. 在 `dsh-subprocess-local` 的 runner `spawn()` 上增加 `windowsHide: true`。

这两处都不是实际弹窗路径：

- 沙箱权限模式下启动 PowerShell 的是 runner 内部的 `CreateProcessAsUserW`，不经过普通 `spawnCurrentTokenJobProcess`。
- Node `spawn()` 的 `windowsHide` 只作用于 runner 进程本身，不会传递到 runner 后续调用的原生 Win32 API。
- 因此安装版虽然在普通路径和 runner 启动处发生了改动，但沙箱路径仍然是 `4`，弹窗问题依旧存在。

## 修复方案

### 选定的实现

在 `@deepseek-ai/dsh-win32-process` 的受限令牌路径中增加 Win32 常量，并仅在 `spawnInheritedJobProcess` 使用它：

```js
/** Process creation flag that prevents a sandboxed console process from opening a window. */
const CREATE_NO_WINDOW = 0x08000000;

function spawnInheritedJobProcess(api, options) {
  const commandLine = buildCommandLine(options.command, options.args);
  return spawnJobProcess(
    api,
    options,
    () => inheritedStandardHandles(api),
    "CreateProcessAsUserW",
    (startupInfo, processInfo) =>
      createRestrictedProcess(
        api,
        options,
        commandLine,
        4 | CREATE_NO_WINDOW,
        startupInfo,
        processInfo,
      ),
  );
}
```

`CREATE_NO_WINDOW` 的正确值是 `0x08000000`。它不是 `80`（十进制）或 `0x50`；把 `1028` 错误改成 `1108` 会启用其他不相关的创建标志，不能作为本问题的修复。

### 方案对比

| 方案 | 是否消除可见窗口 | 控制台关联 | 采用情况 |
| --- | --- | --- | --- |
| 保持 `4` | 否 | 保留可见控制台 | 修复前 |
| `STARTF_USESHOWWINDOW + SW_HIDE` | 是 | 仍创建控制台，仅隐藏显示 | 未采用 |
| `4 \| CREATE_NO_WINDOW` | 是 | 不创建可见控制台窗口 | 已采用 |

选择 `CREATE_NO_WINDOW` 的原因：

- 修复点就在实际弹窗的受限令牌路径。
- 不需要修改共享 `STARTUPINFO`，避免改变 GUI 子进程的初始显示行为。
- 保留挂起创建、Job 绑定、`ResumeThread`、受限令牌和 ACL 权限模型。
- 不修改普通 `CreateProcessW` 路径；完全权限行为保持不变。

## 实际改动

- `patches/@deepseek-ai+dsh-win32-process+0.1.5-rc.1.patch`
  - 增加 `CREATE_NO_WINDOW = 0x08000000`。
  - 仅将 `spawnInheritedJobProcess` 的创建标志改为 `4 | CREATE_NO_WINDOW`。
  - 保持 `spawnCurrentTokenJobProcess` 的 `1028` 不变。
- `scripts/fixtures/windows-acl-sandbox-probe.cjs`
  - 在真实 ACL 沙箱中分别运行 `read-only` 和 `workspace-write`。
  - 检查 PowerShell 是否出现可见控制台。
  - 检查工作区内、外的写入权限边界。
- `test/windows-acl-sandbox.test.js`
  - 使用捆绑 Electron 和真实 runner 启动 fixture。
  - 在存在 PowerShell 7 时同时覆盖 `powershell.exe` 与 `pwsh.exe`。

本次没有增加 `dsh-subprocess-local` 补丁，也没有修改桌面 JavaScript、权限策略或 ACL 实现。

## 验证结果

### 真实沙箱回归

在修复前，`read-only` 和 `workspace-write` 均能复现可见 PowerShell 控制台。加入 `4 | CREATE_NO_WINDOW` 后：

| 权限模式 | 工作区内写入 | 工作区外写入 | 可见控制台 | 退出码 |
| --- | --- | --- | --- | --- |
| `read-only` | 被拒绝 | 被拒绝 | 否 | 正常 |
| `workspace-write` | 成功 | 被拒绝 | 否 | 正常 |

### 自动化命令

```sh
npm ci --no-audit --no-fund
node --test test/windows-acl-sandbox.test.js
npm test
npm run check
```

验证结果：

- 干净安装成功应用新 patch。
- `node --test test/windows-acl-sandbox.test.js`：1/1 通过。
- `npm test`：97/97 通过。
- `npm run check`：通过。
- 安装目录中的依赖文件已替换为与仓库验证版本逐字节一致的版本。
- 用户在本机 DSH Desktop 的 `read-only`、`workspace-write` 和“完全权限”三种模式下完成人工验收，确认前两种不再弹窗，完全权限行为不变。

## 剩余风险

- 该修复通过 `patch-package` 应用于固定版本 `@deepseek-ai/*@0.1.5-rc.1`。应用更新或重新安装 DSH Desktop 后，安装目录可能被覆盖，需要重新应用或升级到包含上游修复的版本。
- `CREATE_NO_WINDOW` 改变的是控制台窗口的创建行为。依赖可见控制台的第三方控制台程序可能需要单独兼容性验证；本次已验证 PowerShell 5.1、PowerShell 7、stdio 管道、退出码和 Job 生命周期。
- 回归测试覆盖 PowerShell；更广泛的终端程序、GUI 子进程和其他平台仍由对应 CI 或后续验收覆盖。

## 参考

- [Microsoft: Process Creation Flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)
- [Microsoft: STARTUPINFOW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-startupinfow)
- [Microsoft: CreateProcessAsUserW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw)

**报告日期**：2026-09-11
