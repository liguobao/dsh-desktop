# Bug 分析报告：pwsh 工具弹出终端窗口问题

> 历史原始方案，仅供了解调查背景，不能直接应用。第 4.3 节的 `1108` / `CREATE_NO_WINDOW (80)` 为错误值；“后台不会弹窗”和低风险保证也尚未成立。已验证的根因、实际补丁与测试结果见 [后续调查报告](windows-pwsh-root-cause-review.md)。下文保留原始记录。

## 一、问题描述

**现象**：当通过 DSH 调用 `pwsh` 工具执行 PowerShell 命令时，每次都会弹出一个 PowerShell 终端窗口，干扰用户操作。

**预期行为**：后台静默执行，不弹出可见窗口。

**实际行为**：前台调用弹出窗口，只有使用 `run_in_background: true` 才能避免弹窗。

---

## 二、影响范围

- **平台**：Windows
- **模块**：`@deepseek-ai/dsh-win32-process`
- **触发场景**：所有通过 `pwsh` 工具执行的前台 PowerShell 命令

---

## 三、根因分析

### 3.1 调用链路

```
dsh-tool-pwsh (工具层)
  └─→ dsh-pwsh-local (执行器)
       └─→ ctx.subprocess.spawn() (子进程服务)
            └─→ dsh-subprocess-local (本地实现)
                 └─→ launchWindowsJob() (Windows Job 启动)
                      └─→ spawnJobProcess() (核心创建函数)
                           └─→ spawnCurrentTokenJobProcess()
                                └─→ CreateProcessW() (Win32 API)
```

### 3.2 问题根源

在 `dsh-win32-process/lib/index.js` 中，`spawnJobProcess()` 函数通过 Win32 API `CreateProcessW` 创建子进程，但 **STARTUPINFOW 结构体配置不完整**：

**当前代码**（第 534-540 行）：
```javascript
encodeStartupInfo(startupInfo, {
    cb: 104,
    dwFlags: 256,  // 只有 STARTF_USESTDHANDLES
    hStdInput: stdio.stdin,
    hStdOutput: stdio.stdout,
    hStdError: stdio.stderr
});
```

**当前调用**（第 615 行）：
```javascript
api.createProcessW(
    options.applicationName,
    commandLine,
    null, null,
    1,                    // bInheritHandles
    1028,                 // dwCreationFlags = CREATE_UNICODE_ENVIRONMENT(1024) + CREATE_SUSPENDED(4)
    environment,
    options.cwd,
    startupInfo,
    processInfo
);
```

### 3.3 缺失的配置

| 常量 | 值 | 作用 | 当前状态 |
|---|---|---|---|
| `STARTF_USESHOWWINDOW` | `0x00000001` (1) | 启用 `wShowWindow` 字段 | ❌ 未设置 |
| `SW_HIDE` | `0x00000000` (0) | 隐藏窗口 | ❌ 未设置 |
| `CREATE_NO_WINDOW` | `0x08000000` (134217728) | 不创建窗口 | ❌ 未设置 |

### 3.4 导致结果

由于未设置 `STARTF_USESHOWWINDOW` 标志，`CreateProcessW` 忽略 `wShowWindow` 字段，使用默认值 `SW_SHOW`，导致 PowerShell 打开一个可见的控制台窗口。

---

## 四、修复方案

### 4.1 修改文件

**路径**：`C:\Program Files\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-win32-process\lib\index.js`

### 4.2 修改点 1：启动信息配置

**位置**：第 534-540 行

```javascript
// 修改前
encodeStartupInfo(startupInfo, {
    cb: 104,
    dwFlags: 256,
    hStdInput: stdio.stdin,
    hStdOutput: stdio.stdout,
    hStdError: stdio.stderr
});

// 修改后
encodeStartupInfo(startupInfo, {
    cb: 104,
    dwFlags: 257,       // 256 + 1: STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW
    wShowWindow: 0,     // SW_HIDE: 隐藏窗口
    hStdInput: stdio.stdin,
    hStdOutput: stdio.stdout,
    hStdError: stdio.stderr
});
```

### 4.3 修改点 2：创建标志

**位置**：第 615 行

```javascript
// 修改前
return spawnJobProcess(api, options, () => targetCarrierHandles(api, options.stdio), "CreateProcessW", (startupInfo, processInfo) => api.createProcessW(options.applicationName, commandLine, null, null, 1, 1028, environment, options.cwd, startupInfo, processInfo));

// 修改后
return spawnJobProcess(api, options, () => targetCarrierHandles(api, options.stdio), "CreateProcessW", (startupInfo, processInfo) => api.createProcessW(options.applicationName, commandLine, null, null, 1, 1108, environment, options.cwd, startupInfo, processInfo));
```

**数值变化**：
- `1028` = `CREATE_UNICODE_ENVIRONMENT (1024)` + `CREATE_SUSPENDED (4)`
- `1108` = `1028` + `CREATE_NO_WINDOW (80)`

### 4.4 STARTUPINFOW 结构体定义

确认结构体已包含 `wShowWindow` 字段（第 48 行），当前已有定义：

```javascript
const STARTUPINFOW = koffi.struct("DSH_STARTUPINFOW", {
    cb: "uint32",
    lpReserved: "str16",
    lpDesktop: "str16",
    lpTitle: "str16",
    dwX: "uint32",
    dwY: "uint32",
    dwXSize: "uint32",
    dwYSize: "uint32",
    dwXCountChars: "uint32",
    dwYCountChars: "uint32",
    dwFillAttribute: "uint32",
    dwFlags: "uint32",
    wShowWindow: "uint16",    // ✅ 已存在
    cbReserved2: "uint16",
    lpReserved2: koffi.pointer("uint8"),
    hStdInput: PVOID,
    hStdOutput: PVOID,
    hStdError: PVOID
});
```

---

## 五、验证方法

### 5.1 修改后测试步骤

1. **重启 DSH Desktop**（关闭并重新打开）
2. **执行前台 pwsh 调用**：
   ```json
   {
     "command": "Write-Host '测试 - $(Get-Date -Format \"HH:mm:ss\")'",
     "description": "验证窗口隐藏"
   }
   ```
3. **观察结果**：不应弹出 PowerShell 窗口

### 5.2 对比测试

| 测试项 | 修改前 | 修改后（预期） |
|---|---|---|
| 前台 pwsh 调用 | 弹出窗口 | 静默执行 |
| 后台 pwsh 调用 | 静默执行 | 静默执行（不变） |
| 输出捕获 | ✅ 正常 | ✅ 正常 |
| 退出码返回 | ✅ 正常 | ✅ 正常 |

---

## 六、风险评估

### 6.1 低风险影响

- ✅ 仅影响 Windows 平台的子进程创建
- ✅ 不改变进程管理机制（Job Object 仍正常工作）
- ✅ 不影响 stdin/stdout/stderr 的管道重定向
- ✅ 后台任务行为不受影响

### 6.2 注意事项

- ⚠️ 需要管理员权限修改系统文件
- ⚠️ DSH 更新后会覆盖修改，需重新应用
- ⚠️ 如果将来需要调试前台命令，可能需要临时移除修改

---

## 七、备选方案

### 7.1 临时规避（当前可用）

对于长时间运行的命令，使用 `run_in_background: true` 参数：

```json
{
  "command": "你的命令",
  "description": "后台运行",
  "run_in_background": true
}
```

### 7.2 上游修复建议

建议向 `@deepseek-ai/dsh-win32-process` 维护者提交 PR，将此修复纳入正式版本。

---

## 八、参考链接

- [Win32 STARTUPINFOW 结构体文档](https://docs.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-startupinfow)
- [Win32 CREATEPROCESS 标志](https://docs.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)
- DSH 源码位置：`C:\Program Files\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-win32-process\`

---

**报告生成时间**：2025年9月11日
**报告作者**：AI Assistant (Agnes)
**审核状态**：待人工审核
