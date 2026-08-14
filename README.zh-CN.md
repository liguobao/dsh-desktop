# DSH Desktop

简体中文 | [English](README.md)

一个独立、开源的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面封装。应用会在本机启动内置的 `@deepseek-ai/dsh` Web UI，并通过经过安全限制的 Electron 窗口加载，支持 Linux、macOS 和 Windows。

> DeepSeek Harness 目前仍处于开发者预览阶段，后续可能出现破坏兼容性的变更。DSH Desktop 会固定已经验证的 Harness 版本，确保每个 Release 可以复现。

## 特性

- Release 安装包开箱即用，不要求用户另外安装 Node.js、npm 或执行 `npx`。
- 自动使用一个空闲的本地回环端口，不会假设 `3080` 一定可用。
- 启动后立即显示基于真实阶段的进度，直到本地 Harness 完成加载。
- 桌面应用与 Harness 服务同时启动、同时退出。
- 提供独立的插件安装和 Skills 管理窗口，支持 npm、GitHub 插件和用户 Skills。
- 对话中的文件入口可直接调用 VS Code、Cursor、VSCodium 或 Zed；工作区可从侧栏菜单、会话标题栏或原生菜单交给编辑器和文件管理器打开。
- 默认关闭 Electron Node 注入，并阻止不可信页面在应用内导航。
- 使用 GitHub Actions 构建原生安装包和免安装版本。
- 同时支持 Intel 与 Apple Silicon Mac。

## 下载与安装

从 [GitHub Releases](https://github.com/liguobao/dsh-desktop/releases) 下载最新版本：

| 平台 | 安装包 |
| --- | --- |
| Windows x64 安装版 | `DSH-Desktop-vX.Y.Z-windows-x64-setup.exe` |
| Windows x64 绿色版 | `DSH-Desktop-vX.Y.Z-windows-x64-portable.exe` |
| macOS Apple Silicon | `DSH-Desktop-vX.Y.Z-macos-arm64.dmg` |
| macOS Intel | `DSH-Desktop-vX.Y.Z-macos-x64.dmg` |
| Linux x64 | `DSH-Desktop-vX.Y.Z-linux-x64.AppImage` |

每个 Release 会同时提供 Windows 安装版和绿色版。其他平台按架构提供一种推荐安装包，不再发布压缩包或其他 Linux 包格式。

当前社区 CI 构建尚未进行商业代码签名，因此 Windows SmartScreen 或 macOS Gatekeeper 可能显示警告。继续运行前建议检查 Release 对应的源码与构建工作流。macOS 请优先使用标准的**按住 Control 点击 → 打开**方式，不要在系统范围关闭 Gatekeeper。

如果 macOS 仍提示应用已损坏或无法验证开发者，请先将应用拖到 `/Applications`，确认安装包来自本仓库的 GitHub Release，然后在“终端”中仅为 DSH Desktop 清除隔离属性：

```bash
xattr -dr com.apple.quarantine "/Applications/DSH Desktop.app"
```

运行 AppImage：

```bash
chmod +x DSH-Desktop-*.AppImage
./DSH-Desktop-*.AppImage
```

## 使用方法

1. 启动 DSH Desktop，等待本地 Harness 服务就绪。
2. 打开**设置 → 模型**，配置 DeepSeek API Key 或其他受支持的模型提供方。
3. 添加并选择一个工作区。
4. 创建会话并开始任务。

Harness 的具体使用方式可参考上游 [Web UI 指南](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart)。

对话里点击代码或文本文件时，桌面适配插件会使用检测到的编辑器打开；HTML、图片、PDF 和目录仍交给系统默认程序。侧栏中每个工作区的 **…** 菜单提供**用编辑器打开**和**打开文件夹**，会话标题栏的 VS Code 图标也会在首选编辑器中打开当前工作区。还可以通过原生菜单的**工作区 → 首选编辑器**选择 VS Code、Cursor、VSCodium 或 Zed。未检测到支持的编辑器时，文件会回退到系统默认程序；显式使用编辑器打开时会显示错误提示。

窗口最上方的**扩展**菜单提供**插件安装**和 **Skills管理**。插件支持 npm 包名和 GitHub 仓库地址；未指定版本时安装最新 Tag，并固定到 Commit。已安装的 GitHub 插件可在线更新到默认分支最新版。修改后需重启 Harness。

GitHub 插件默认禁用安装和构建脚本，确有需要时可在页面授权。插件拥有与 Harness 相同的本机权限，请仅安装可信代码。

Skills 管理窗口支持创建、导入、定位、启停和删除用户 Skill。Skill 变化不需要重启 Harness。

可以通过**视图 → 重启 Harness**重启本地服务，通过**帮助 → 打开日志目录**查看诊断日志。

## 工作原理

```text
DSH Desktop
├─ Electron 主进程
│  ├─ 受限的本地路径打开桥接
│  ├─ 插件 Profile 服务与内置 pnpm
│  ├─ 用户 Skill 文件系统管理器
│  └─ 以 Node 模式运行的内置 Electron
│     └─ @deepseek-ai/dsh web --patch <桌面适配层> --port 0
├─ 沙箱化 Harness 窗口
│  └─ http://127.0.0.1:<自动分配端口>
├─ 沙箱化本地插件管理窗口
│  └─ $DSH_HOME/profiles/web/package.json
└─ 沙箱化本地扩展管理窗口
   └─ $DSH_HOME/skills
```

桌面能力由本仓库内的独立双端插件 `@dsh-desktop/integration` 提供。启动时应用只把该插件复制到 `$DSH_HOME/profiles/node_modules` 的上游扩展解析目录，再用一次性 `--patch` 加载；不会修改 `@deepseek-ai/dsh` 的 CLI 源码、安装包或用户的 `cordis.patch.yml`。

应用从官方 `dsh web` 的就绪输出中读取实际 URL。只有该本地回环 Origin 可以留在应用窗口中，普通 HTTP/HTTPS 外链会交给系统浏览器。退出应用时会同时终止本地 Harness 进程树。

## 本地开发

环境要求：

- Node.js 22 或更高版本
- npm 10 或更高版本

```bash
git clone https://github.com/liguobao/dsh-desktop.git
cd dsh-desktop
npm ci
npm start
```

常用命令：

```bash
npm test           # 单元测试
npm run check      # JavaScript 语法检查
npm run dist:linux
npm run dist:mac
npm run dist:windows
```

Electron 安装包应在对应的目标操作系统上生成，仓库内的 GitHub Actions 会自动完成这些构建。

## 发布版本

推送语义化版本 Tag 后，GitHub Actions 会构建全部平台并创建 GitHub Release：

```bash
npm version 0.1.1 --no-git-tag-version
git commit -am "release: v0.1.1"
git tag -a v0.1.1 -m "DSH Desktop v0.1.1"
git push origin HEAD --follow-tags
```

当前工作流不会保存任何签名身份。维护者后续可以加入 Apple 签名与公证、Windows 代码签名，而不需要调整应用架构。

## 安全说明

DeepSeek Harness 是可以读取和修改所选工作区文件、并按授权执行命令的 Agent Harness。开始任务前，请检查当前工作区、模型提供方和权限提示。

本地 HTTP 服务只绑定 `127.0.0.1`。所有渲染进程都无法访问 Node.js，也不能离开各自限定的 Origin 或本地页面。Harness preload 只接受来自精确 Harness Origin 的工作区范围和授权路径打开消息；插件和扩展管理窗口使用不同的 preload 和精确本地页面校验，分别只暴露固定的插件或 Skill 操作，包管理命令只使用参数数组且不经过 Shell。Skill 修改被限制在两个应用管理目录的直属条目内，导入时拒绝符号链接。主进程仍会拒绝工作区外路径和符号链接逃逸。漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 项目状态与商标

本项目是独立的社区封装，并非 DeepSeek 官方产品。DeepSeek 及相关名称和标志归各自权利人所有。

DSH Desktop 使用 [MIT License](LICENSE)。DeepSeek Harness 同样采用 MIT License，详见 [NOTICE.md](NOTICE.md)。
