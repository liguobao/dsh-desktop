# DSH Desktop

简体中文 | [English](README.md)

一个独立、开源的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面应用。它内置经过验证的 Harness 版本，并通过经过安全限制的 Electron 窗口在 Windows、macOS 和 Linux 本地运行。

> DSH Desktop 是社区项目，并非 DeepSeek 官方产品。DeepSeek Harness 目前仍处于开发者预览阶段，后续可能出现破坏兼容性的变更。

## 主要功能

- 安装包开箱即用，无需另外安装 Node.js、npm 或执行 `npx`。
- 内置版本匹配的 DeepSeek Harness、Remote 和 File Viewer 组件。
- 只读预览源码、文本、Markdown、图片、PDF、CSV、JSON 和 YAML。
- 从另一台已授权的电脑、手机、平板或浏览器继续远程会话。
- 从 npm 或 GitHub 搜索和安装插件。
- 使用 VS Code、Cursor、VSCodium、Zed 或系统文件管理器打开工作区。
- Harness 服务仅监听本机，Electron 渲染进程受限，外部链接交给系统浏览器。
- 自动检查新版 DSH Desktop，并对下载的安装包进行 SHA-256 校验。

## 下载

从 [GitHub Releases](https://github.com/liguobao/dsh-desktop/releases) 下载最新版本。

中国大陆用户可使用 [Quark Cloud Drive / 夸克网盘](https://pan.quark.cn/s/a837649635e2#/list/share/b4cc08109f3d47f78bc816ef2dbecd4f) 下载。

| 平台 | 安装包 |
| --- | --- |
| Windows x64 安装版 | `DSH-Desktop-vX.Y.Z-windows-x64-setup.exe` |
| Windows x64 便携版 | `DSH-Desktop-vX.Y.Z-windows-x64-portable.exe` |
| macOS Apple Silicon | `DSH-Desktop-vX.Y.Z-macos-arm64.dmg` |
| macOS Intel | `DSH-Desktop-vX.Y.Z-macos-x64.dmg` |
| Linux x64 | `DSH-Desktop-vX.Y.Z-linux-x64.AppImage` |
| DSH Remote Android 客户端 | `dsh-remote-android-vA.B.C.apk` |

Android 客户端 APK 版本号跟随内置 Remote 组件。macOS 安装包已使用 Developer ID 签名并完成 Apple 公证。Windows 仍可能显示 SmartScreen 提示，请仅安装来自本仓库 Release 页面或上述镜像的文件。

运行 AppImage：

```bash
chmod +x DSH-Desktop-*.AppImage
./DSH-Desktop-*.AppImage
```

## 快速开始

1. 启动 DSH Desktop，等待 Harness 就绪。
2. 打开**设置 → 模型**，配置 DeepSeek API Key 或其他受支持的模型提供方。
3. 添加或选择工作区。
4. 创建会话并开始任务。

模型、工作区和会话的使用方式可参考上游 [Harness Web UI 指南](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart)。

通过**插件**菜单搜索或管理插件。插件拥有与 Harness 相同的本机权限，请仅安装可信来源；修改插件后需重启 Harness。

DSH Desktop 会检查 GitHub Releases。下载并校验对应平台的安装包后，可以直接打开安装包，应用会退出以便系统完成更新。DeepSeek Harness 及其他内置组件随 DSH Desktop 一起更新。

## 本地开发

需要 Node.js 22 或更高版本，以及 npm 10 或更高版本。

```bash
git clone https://github.com/liguobao/dsh-desktop.git
cd dsh-desktop
npm ci
npm start
```

```bash
npm test
npm run check
npm run dist:linux
npm run dist:mac
npm run dist:windows
```

安装包应在对应的目标操作系统上构建。推送匹配的 `vX.Y.Z` Tag 后，GitHub Actions 会构建全部支持的平台。

## 安全与许可

Harness 可以读取和修改所选工作区中的文件，并按授权执行命令。开始任务前，请检查当前工作区、模型提供方、已安装插件和权限提示。安全设计与漏洞报告方式见 [SECURITY.md](SECURITY.md)。

DSH Desktop 使用 [MIT License](LICENSE)，第三方声明见 [NOTICE.md](NOTICE.md)。
