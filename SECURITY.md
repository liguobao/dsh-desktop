# Security Policy / 安全策略

## Reporting a vulnerability

Please do not publish a reproducible vulnerability in a public issue. Use GitHub's **Security → Report a vulnerability** form for this repository. Include the affected DSH Desktop version, operating system, reproduction steps, impact, and any suggested mitigation.

Only the latest DSH Desktop release is actively supported. Vulnerabilities in the bundled DeepSeek Harness should also be reported to the [upstream project](https://github.com/deepseek-ai/deepseek-harness/security).

## Plugin security

Harness plugins are executable npm packages, not passive themes or data files. They run locally with the same operating-system permissions as Harness. The plugin manager accepts registry package names only, invokes the bundled package manager without a shell, and restricts its IPC bridge to the app's local plugin-manager page. These controls prevent command-string injection; they do not make untrusted plugin code safe. Review a plugin's publisher, source, dependency tree, and requested behavior before installing it.

## 报告漏洞

请不要在公开 Issue 中发布可以直接复现的漏洞。请使用本仓库 GitHub 页面中的 **Security → Report a vulnerability** 私密报告入口，并提供受影响的 DSH Desktop 版本、操作系统、复现步骤、影响和建议的缓解方式。

目前只主动维护最新版本。若漏洞来自内置的 DeepSeek Harness，也请同时向[上游项目](https://github.com/deepseek-ai/deepseek-harness/security)报告。

## 插件安全

Harness 插件是可以执行代码的 npm 软件包，并非被动的主题或数据文件；它们会在本机以 Harness 相同的操作系统权限运行。插件管理器只接受 Registry 包名，调用内置包管理器时不经过 Shell，并将 IPC 桥接限定在应用自身的本地插件管理页。这些措施可以阻止命令字符串注入，但不能让不可信的插件代码变得安全。安装前请检查插件发布者、源码、依赖树和实际行为。
