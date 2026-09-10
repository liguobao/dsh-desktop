# PowerShell 控制台弹窗：根因、修复与验证

## 结论

在无控制台的 Electron run-as-node 进程中，普通 Windows Job 路径通过 `CreateProcessW(..., 1028, ...)` 启动 PowerShell，会创建可见控制台。仅隐藏 Harness 父进程不能让后续原生进程创建自动继承同一策略。

本次针对桌面 `0.1.56`（调查基线 `a2ec500`）锁定的 `@deepseek-ai/*@0.1.5-rc.1` 依赖生成两个 patch-package 补丁。没有修改 Program Files 中的安装文件。

## 代码依据

| 层级 | 文件 / 函数 | 事实 |
| --- | --- | --- |
| 桌面启动 | `src/main.js` | 使用 process.execPath 和 ELECTRON_RUN_AS_NODE=1 |
| Harness 启动 | `src/harness-server.js` | 已有 windowsHide: true、shell: false、管道 stdio |
| 工具前后台 | `dsh-tool-pwsh/lib/index.js` | 前台调用 shell.run，后台通过 jobs 调用 shell.start |
| 执行器 | `dsh-pwsh-local/lib/index.js` | runArgv 和 startArgv 都调用 ctx.subprocess.spawn，没有按前后台选择隐藏窗口的分支 |
| runner 创建 | `dsh-subprocess-local/lib/index.js` 的 launchWindowsJob | Node spawn 启动独立 runner，原来没有 windowsHide |
| 目标创建 | `dsh-subprocess-local/lib/runner.js` | 使用 fd 4/5/6 的 stdio carrier 调用 spawnCurrentTokenJobProcess |
| 原生创建 | `dsh-win32-process/lib/index.js` | 原创建标志仅为 CREATE_UNICODE_ENVIRONMENT 和 CREATE_SUSPENDED |

最初依据来自版本匹配的本机安装依赖；随后在本仓库 npm ci 获取的依赖上完成真实 runner 回归。原报告声称“只有前台弹窗，后台不弹窗”，尚未解释或复现这种差异，不能将后台模式视为可靠规避方案。

## 隔离实验与修复选择

先前隔离实验以无控制台的 Electron 启动已安装的 Win32 helper，仅在实验进程内替换 API 参数，PowerShell 通过 GetConsoleWindow 和 IsWindowVisible 读取状态：

| 配置 | 控制台存在 | 控制台可见 | 中文 stdout / stderr | 退出码 | 正常退出后 Job 已空 |
| --- | --- | --- | --- | --- | --- |
| 原始 1028 | 是 | 是 | 正常 | 7 | 是 |
| STARTF_USESHOWWINDOW + SW_HIDE | 是 | 否 | 正常 | 7 | 是 |
| 添加 CREATE_NO_WINDOW | 否 | 否 | 正常 | 7 | 是 |

两种方式都消除该实验中的可见控制台，但 SW_HIDE 保留控制台，CREATE_NO_WINDOW 改变控制台关联。本补丁选择后者，避免在共享 STARTUPINFO 中设置 SW_HIDE 而改变 GUI 程序初始显示行为。CREATE_NO_WINDOW 对非控制台程序会被忽略。

正确值是 `1028 | 0x08000000 = 134218756`（0x08000404）。原始方案的 `1108` 是 0x454，额外启用了 CREATE_NEW_CONSOLE 和 IDLE_PRIORITY_CLASS，不能用于修复。

## 实际改动

- `patches/@deepseek-ai+dsh-win32-process+0.1.5-rc.1.patch`：只在普通令牌 Job 创建点增加 CREATE_NO_WINDOW，保留 Unicode 环境、挂起创建、句柄继承、Job 绑定和 ResumeThread。
- `patches/@deepseek-ai+dsh-subprocess-local+0.1.5-rc.1.patch`：runner 的 Node spawn 增加 windowsHide: true。这是显式后台启动策略；未将 runner 独立弹窗认定为已验证的第二个根因。
- `test/windows-subprocess.test.js` 和 `scripts/fixtures/windows-subprocess-probe.cjs`：在真实捆绑 Electron 下运行 LocalSubprocessRuntime，经过实际 runner、Win32 API 和管道，不替换成模拟子进程。

不改共享 STARTUPINFO、受限令牌函数、ConPTY 或桌面用户主动打开应用的路径。普通 Job 控制台命令会失去控制台关联，依赖控制台 API 的其他程序仍需兼容性评估。

仓库已有 postinstall: patch-package，npm ci 时自动应用补丁。上游修复对应 packages/subprocess/win32-process 和 packages/subprocess/subprocess-local；升级到包含等效修复的版本时应移除补丁。

## 回归验证

新测试使用完整 Electron / PowerShell 路径，环境 PATH 仅含 System32，不依赖用户安装的 node/npm/pnpm。测试 Windows PowerShell 5.1，以及机器安装在 Program Files 标准路径的 PowerShell 7（如果存在）。

测试断言包括：

- Electron 父进程没有控制台，PowerShell 目标也没有控制台。
- runner 使用 process.execPath、ELECTRON_RUN_AS_NODE=1、windowsHide: true 和最小 PATH。
- stdin 标记、中文 stdout、stderr、退出码 7、带空格工作目录和环境变量正确。
- AbortSignal 能终止长任务并完成 waitForExit。

在添加生产补丁前，回归测试明确失败于“PowerShell must not allocate a console”；添加补丁后通过。最初隔离实验只覆盖文件句柄；本回归进一步覆盖真实 runner 与管道。

验证命令：

```sh
npm ci --no-audit --no-fund
node --test test/windows-subprocess.test.js
npm test
npm run check
```

本机最终结果：干净 npm ci 成功应用两个补丁；npm test 为 97/97 通过；npm run check 及新增脚本的 node --check 均通过。本机仓库回归使用 Windows PowerShell 5.1；前述隔离对比另覆盖 PowerShell 7。其他平台由 PR 的构建矩阵继续验证。

尚需发布验收：从 Explorer 启动最终安装包并观察前后台命令是否瞬间闪窗、抢焦点；真实 UI job_kill、子孙进程清理、大输出、沙箱、PTY、GUI 命令和跨平台回归。当前自动化覆盖普通 Job 路径，未模拟完整模型工具会话。

## 参考

- [原始方案（历史记录，含已指出的错误）](windows-pwsh-original-analysis.md)
- [Microsoft：Process Creation Flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)
- [Microsoft：STARTUPINFOW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-startupinfow)
