# 安装与 AI 用量配置

## 环境

实测为 Apple Silicon Mac + macOS 15 及以上、Android 8.1 / API 27 的小米多看 Pro。Node.js 22 或更高、Python 3、OpenJDK 17、Android SDK platform 34 / build-tools 34.0.0 / platform-tools，以及 macOS Command Line Tools（Swift 编译器）。Node 服务没有 npm 依赖。

先安装自己信任的官方工具：[Android SDK](https://developer.android.com/tools)、[Node.js](https://nodejs.org/)、[Codex CLI](https://developers.openai.com/codex/cli/)、[Claude Code](https://code.claude.com/docs/en/setup)。登录在 Mac 完成，阅读器不接收 OpenAI 或 Anthropic 登录凭据。

```sh
git clone https://github.com/Eason-Xi/MiBook.git
cd MiBook
xcode-select --install
# 如尚未安装下列 SDK 组件：
sdkmanager 'platforms;android-34' 'build-tools;34.0.0' 'platform-tools'
```

Apple Silicon Homebrew 环境默认查找：

```sh
export MIBOOK_JAVA_HOME=/opt/homebrew/opt/openjdk@17
export MIBOOK_ANDROID_SDK=/opt/homebrew/share/android-commandlinetools
export MIBOOK_ADB="$MIBOOK_ANDROID_SDK/platform-tools/adb"
```

按自己的实际安装目录调整路径，不需要新建与作者相同的用户目录。`MIBOOK_JAVA_HOME` 指向包含 `bin/java` 的目录，`MIBOOK_ANDROID_SDK` 指向包含 `platforms/`、`build-tools/` 的目录。也可以把 SDK 的 platform-tools 加入 PATH。

## 登录和编译

```sh
codex login
claude
# 在 Claude Code 中按其提示完成 /login，然后退出。
bash scripts/build.sh
```

阅读器开启 USB 调试、插上 USB 并允许这台 Mac 调试后：

```sh
"$MIBOOK_ADB" devices
"$MIBOOK_ADB" install --no-streaming -r dist/codex-usage.apk
```

第一次构建会在 `.state/display.keystore` 生成本地签名密钥。请自己备份此密钥；以后覆盖升级必须沿用相同签名。其他人自行构建的 APK 签名不同，不能直接覆盖你已有的安装。

## 配对并启动同步

阅读器与 Mac 连接可互访的同一局域网。服务使用 TCP 48763，Bonjour 用于地址发现；不要把此端口转发到公网。配对认证令牌随机生成并只保留在两端。

```sh
node scripts/install-claude.mjs
node scripts/install-sync.mjs
node scripts/pair-wifi.mjs
```

配对脚本会自动选择唯一一台已授权的 ADB 设备，多设备时先设置 `MIBOOK_SERIAL`。默认优先使用项目本地 `.tools/platform-tools/adb`，其次使用 PATH 中的 `adb`，也可用 `MIBOOK_ADB` 指定。

Claude 安装脚本会备份原设置，保留已有状态栏的输出。主动刷新通过独立 PTY 查询 Claude Code 的 `/usage` 面板，只保存额度白名单字段；不发送模型提示词。如果 Claude 显示安全／目录信任提示，需要你先在 Mac 手动处理，程序不会自动确认。

同步服务是当前用户的 LaunchAgent：`dev.mibook.codexusage.sync`。项目所在目录在运行时必须保留。

## 可选路径覆盖

| 变量 | 用途 |
| --- | --- |
| `MIBOOK_ADB` | ADB 可执行文件 |
| `MIBOOK_SERIAL` | 要配对的阅读器序号 |
| `MIBOOK_CODEX` | Codex CLI 可执行文件，默认从 PATH 查找 |
| `MIBOOK_CLAUDE` | Claude CLI，默认 `~/.local/bin/claude` |
| `MIBOOK_PYTHON` | PTY Python，默认 `/usr/bin/python3` |
| `MIBOOK_JAVA_HOME` | OpenJDK 17 根目录 |
| `MIBOOK_ANDROID_SDK` | Android SDK 根目录 |

先设置变量，再运行 `install-sync.mjs`，这些路径覆盖会写入 LaunchAgent；不要把 API Key 或登录令牌当作路径变量传入。服务使用本机已登录的 CLI。

## 使用与验证

打开阅读器的「AI 用量」。上方可切换横／竖屏，下方可立即同步或切换自动休眠。默认自动休眠关闭。开启后由独立闲置计时控制，分钟时钟和用量更新不会延后休眠；当前固件需要在 Magisk 的 Superuser 页面允许「AI 用量」使用 Root。

```sh
node bridge/sync.mjs --once
node --test bridge/*.test.mjs
bash scripts/test-android.sh
launchctl print "gui/$(id -u)/dev.mibook.codexusage.sync"
```

`--once` 只刷新 Mac 本地快照。连接失败时查看本地 `.state/sync-error.log`；请勿将完整日志、配对文件或个人用量快照直接公开。Mac 睡眠或离线会保留旧数据，阅读器离开应用或休眠会暂停前台同步。

## 停用与迁移

```sh
bash scripts/stop-sync.sh
```

此命令只移除 Mac 同步服务，保留 APK 和数据。Claude 状态栏需要根据 `.state/claude-statusline-original.json` 恢复原 `statusLine` 配置，勿用旧备份覆盖之后新增的其他 Claude 设置。项目移动后重新运行两个安装脚本与 Mac App 构建脚本；必要时重新配对。
