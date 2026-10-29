# MiBook · 小米阅读器 AI 用量与自选屏保

把小米多看 Pro 变成 Codex / Claude 用量看板，并从 Mac 通过 Wi-Fi 更换休眠屏保。仓库包含 Android 应用、Mac 屏保编辑器、本地同步服务，以及这台设备实测使用的 Root、备份和恢复方法。

**实测设备：MiDuoKanReaderPro / virgo-perf1，Android 8.1，MiReaderPro 1.1.15.220615。Root 与系统屏保修改只适配这一型号和固件。**

## 功能

- **AI 用量**：Codex 短期／每周、Claude 5 小时／每周四项额度，显示剩余百分比与重置时间。
- **自动同步**：每逢 00、05、10……55 分同步，支持立即同步；离线保留上次数据，未知额度不显示成零。
- **阅读器显示**：横／竖屏切换、台北时间与日期、大字黑白布局。
- **自动休眠**：打开后闲置 5 分钟休眠，关闭后前台保持显示；当前固件需要既有 Root 授权执行可靠的自动休眠。
- **Mac 屏保编辑**：导入横屏或竖屏图，拖动、缩放、旋转、裁切／留白、灰度转换，自动保存编辑进度。
- **无线换屏保**：通过已配对的 Wi-Fi 下发可停用的 Magisk 资源模块，重启后校验系统资源和像素；可恢复原屏保。

| 组件 | 当前版本 |
| --- | --- |
| 阅读器「AI 用量」 | 2.0.1 |
| Mac「小米屏保」 | 2.1.0 |
| 本机实测 Magisk | 31.1 |

## 从哪里开始

1. [安装与 AI 用量配置](docs/SETUP.md)：开发依赖、编译、安装 APK、Codex / Claude 登录、USB 配对、Mac 开机同步。
2. [完整 Root、备份与恢复方法](docs/ROOT.md)：核对型号 → 获取工具 → 导出原始分区 → 准备恢复包 → 修补自己的 boot → Recovery 安装 → 验证 Root。
3. [横屏屏保与画面调整](docs/SCREENSAVER.md)：Mac 编辑器、无线发送、重启原因、恢复系统屏保。
4. [架构、数据与验证](docs/ARCHITECTURE.md)：组件职责、网络协议、凭据边界和测试命令。
5. [第三方来源](THIRD-PARTY.md)：Magisk、Recovery 参考项目、Android 工具与官方接口。

只看 AI 用量可以先按安装文档完成配对；更换系统屏保和当前固件上的可靠自动休眠需要 Root。Root 可能导致启动失败或影响 OTA，请先阅读备份、恢复边界，再执行会写入 boot 的步骤。

## 快速构建

完整依赖见安装文档。Mac 屏保工具要求 macOS 15 或更高，当前在 Apple Silicon Mac 验证。

```sh
bash scripts/build.sh
bash scripts/build-mac-screensaver.sh
node --test bridge/*.test.mjs
bash scripts/test-android.sh
bash scripts/test-mac-screensaver.sh
```

产物为 `dist/codex-usage.apk` 与 `dist/小米屏保.app`。Mac App 的构建会记录当前项目位置，因此请保留克隆目录；移动项目后重新构建 App 并重装同步服务。

## 仓库内容与本地数据

| 目录 | 内容 |
| --- | --- |
| `android/` | 原生 Java 阅读器应用与闲置计时测试 |
| `macos/` | SwiftUI 屏保编辑器，以及本机适配历史记录 |
| `bridge/` | 无 npm 依赖的 Node.js 同步服务、Claude 查询器与回归测试 |
| `scripts/` | 编译、配对、服务安装、Root 依赖下载和 Recovery 包生成工具 |
| `docs/` | 安装、Root、屏保、架构说明 |
| `.github/workflows/` | 用量桥接与闲置计时 CI |

`.state/`、`.tools/`、`build/`、`dist/` 均不进入 Git。个人图片、阅读器备份／镜像、配对令牌、账户用量、CLI 登录信息及项目签名密钥留在使用者自己的电脑。Root 工具按上游地址下载并核对 SHA-256；仓库不分发他人的 boot 镜像或厂商固件。

更详细的演进和实测记录见 [实现记录](docs/IMPLEMENTATION-NOTES.md)、[固件适配](macos/SCREENSAVER-FIRMWARE.md)、[Root 恢复记录](macos/ROOT-RECOVERY.md)。这些历史记录中的本地路径和摘要只作为证据说明，镜像本身没有上传。
