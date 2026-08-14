# Security Policy / 安全策略

## Reporting a vulnerability

Please do not publish a reproducible vulnerability in a public issue. Use GitHub's **Security → Report a vulnerability** form for this repository. Include the affected DSH Desktop version, operating system, reproduction steps, impact, and any suggested mitigation.

Only the latest DSH Desktop release is actively supported. Vulnerabilities in the bundled DeepSeek Harness should also be reported to the [upstream project](https://github.com/deepseek-ai/deepseek-harness/security).

## Plugin security

Harness plugins are executable packages, not passive themes or data files. They run locally with the same operating-system permissions as Harness. The extension manager accepts registry names or HTTPS GitHub repositories pinned to a tag or commit, invokes the bundled package manager with an argument array rather than a shell, suppresses GitHub dependency scripts on the first pass, and restricts its IPC bridge to the app's local extension page. Script execution for a GitHub dependency requires an explicit UI opt-in. These controls prevent command-string injection; they do not make untrusted plugin code safe. Review a plugin's publisher, pinned source, dependency tree, and requested behavior before installing it.

User Skills can influence model behavior and tool use. DSH Desktop manages only direct entries under `$DSH_HOME/skills` and `$DSH_HOME/.disabled-skills`; imported folders must contain valid Harness frontmatter and cannot contain symbolic links. Removal uses the operating system Trash. These boundaries do not make imported instructions trustworthy, so review every Skill and its resources before enabling it.

## 报告漏洞

请不要在公开 Issue 中发布可以直接复现的漏洞。请使用本仓库 GitHub 页面中的 **Security → Report a vulnerability** 私密报告入口，并提供受影响的 DSH Desktop 版本、操作系统、复现步骤、影响和建议的缓解方式。

目前只主动维护最新版本。若漏洞来自内置的 DeepSeek Harness，也请同时向[上游项目](https://github.com/deepseek-ai/deepseek-harness/security)报告。

## 插件安全

Harness 插件是可以执行代码的软件包，并非被动的主题或数据文件；它们会在本机以 Harness 相同的操作系统权限运行。扩展管理器只接受 Registry 包名或固定到 Tag/Commit 的 HTTPS GitHub 仓库，使用参数数组调用内置包管理器而不经过 Shell，首次处理 GitHub 依赖时会禁止运行脚本，并将 IPC 桥接限定在应用自身的本地扩展页。GitHub 依赖执行脚本前必须由用户在界面中明确授权。这些措施可以阻止命令字符串注入，但不能让不可信的插件代码变得安全。安装前请检查插件发布者、固定版本对应的源码、依赖树和实际行为。

用户 Skills 会影响模型行为和工具调用。DSH Desktop 只管理 `$DSH_HOME/skills` 与 `$DSH_HOME/.disabled-skills` 下的直属条目；导入目录必须包含有效的 Harness frontmatter，并且不能包含符号链接。移除操作会使用系统废纸篓。这些边界并不能保证导入指令可信，启用前请检查 Skill 及其全部资源。
