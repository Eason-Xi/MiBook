> 这是开发过程的详细实现记录；新安装请优先阅读 [安装文档](SETUP.md)、[Root 流程](ROOT.md) 与 [屏保说明](SCREENSAVER.md)。

# 小米阅读器 Codex / Claude 用量看板

为 MiDuoKanReaderPro（Android 8.1 / API 27、1404 × 1872）制作的本地 Android 应用，应用名 **AI 用量**，包名 `dev.mibook.codexusage`。

- **1.8.1 版 Claude 主动刷新**：每个五分钟同步时段及“立即同步”会并行查询 Codex 和 Claude。Mac 通过系统 Python PTY 打开 Claude Code 自带的 `/usage` 查询，直接从 `/usage` 面板读取额度；不发送模型消息，也不依赖新会话中尚未生成的状态栏额度字段。刷新超时保留旧记录和原数据时间，并在阅读器显示刷新失败／旧数据。查询前先检查 CLI 登录状态；未登录时需在 Mac 运行 `claude` 后执行 `/login`。Wi-Fi 请求最多等待上游刷新 10 秒，随后返回已有快照，上游查询继续在后台完成，防止阅读器网络请求超时。需要 `/usr/bin/python3` 和 `~/.local/bin/claude`，可分别用 `MIBOOK_PYTHON`、`MIBOOK_CLAUDE` 覆盖。

- **1.7 版 Claude 接入**：同时展示 Codex 短期／每周、Claude 5 小时／每周四项额度，横竖屏均为四卡片布局。
- Claude 使用官方 [statusLine 数据](https://code.claude.com/docs/en/statusline)，仅读取 `rate_limits` 的百分比及重置时间，不读取 Claude 登录令牌。运行 `node scripts/install-claude.mjs` 安装本地采集器，会备份用户设置并保留已有状态栏的输出。
- Claude 每五分钟主动刷新，也可随日常 Claude Code 状态栏事件更新。无需保持终端会话打开；界面分别显示 Codex 与 Claude 的数据时间，未知额度不当作零用量。
- Claude 采集器只保存额度白名单字段到 `.state/claude-usage.json`，不保存会话正文、路径或身份。项目目录移动后需要重装采集器。

- 黑白大字显示 Codex 和 Claude 额度的剩余百分比、进度条、重置时间和数据时间。
- 横竖屏顶部正中间显示台北时间 `HH:mm`、年月日和星期，应用前台按整分钟更新。
- 右上角切换横屏 / 竖屏，自动记住选择。两种方向均为上排 Codex、下排 Claude，每排左侧短期、右侧每周额度。
- **1.6 版“自动休眠”开关**：替代原来的锁屏封面按钮。开：看板闲置 5 分钟自动休眠；关：看板在前台时保持屏幕显示，无论使用充电或电池供电。重开应用保留选择，默认关闭。实体电源键仍可手动休眠。
- **2.0.1 修复自动休眠**：本机固件会把屏幕重绘记为 `NO_CHANGE_LIGHTS` 活动，分钟时钟刷新会不断推迟系统休眠。看板增加独立的前台闲置计时，只有触摸／按键、重新进入看板或开启开关才重新计时；时钟和用量同步不会延后休眠。闲置 5 分钟后经现有 Magisk Root 授权发送系统 `KEYCODE_SLEEP`，使用原生休眠屏保。退出看板、失去焦点或关闭开关会取消计时；唤醒回到看板后重新计时。执行前再次核对开关、前台和用户操作，Root 不可用或执行失败会显示错误。
- 保留 Android 8.1 的每窗口 `userActivityTimeout` 与 `FLAG_KEEP_SCREEN_ON`，不改写全局 `screen_off_timeout`，不申请设备管理员权限。退出看板后由当前前台应用和系统设置决定休眠。
- 每小时 00、05、10、15……55 分自动同步用量。到点请求 Mac 刷新上游并等待结果；手动同步不会改变钟点时间表。打开 / 唤醒应用时立即同步，界面显示下次同步时间。
- Mac 使用本机 Codex CLI 的 `account/rateLimits/read` 读取账户额度，不启动模型任务。阅读器与 Mac 在同一可互访局域网内即可，首次经 USB 配对，之后通过 Wi-Fi 更新。
- Mac 在 48763 端口提供用量 HTTP 服务，以随机配对令牌验证访问。OpenAI 凭据保留在 Mac，配对令牌不打包进 APK。
- Bonjour / Android NSD 自动发现配对的 Mac，并保留最后成功地址作为后备。多播发现受限且地址变化时可重新运行配对脚本。
- Mac 休眠、关机或网络不可达时保留最近数据并显示状态。阅读器休眠或离开应用时暂停同步，回到看板后恢复。缺失用量显示未知，不当成零用量。
- 用量看板自动生成休眠封面的旧功能已移除。原生屏保路径的限制与 Root 适配见下文。

## Mac 屏保工具（2.1：横屏与构图调整）

这台 MiDuoKanReaderPro / Android 8.1 / MiReaderPro 1.1.15.220615 已完成 Magisk 31.1 Root。
Mac 的 `dist/小米屏保.app` 支持选择横屏／竖屏图片，自动按原图方向设置画布，也可手动切换。竖屏构图为 1404 × 1872，横屏为 1872 × 1404，预览会随方向切换。

可在预览上直接拖动图片，也可用左右／上下滑块调整裁切位置、100%～300% 缩放、每次顺时针旋转 90°、复位构图，选择铺满裁切／完整留白及灰度转换。移动范围按实际图片尺寸计算，铺满模式不会拖出空白；需要更大移动范围时先放大。编辑原图副本及参数自动保存在 `.state/screensaver/editor-source.image` 和 `editor.json`，重新打开继续编辑，不改写原始图片。导出使用所选画布方向。

发送横屏图片时，将横向构图逐像素顺时针旋转为固件使用的 1404 × 1872 物理屏保格式，通过原配对 Wi-Fi 通道与资源校验流程应用。横握阅读器观看横向图片；固件另外绘制的日期仍保留系统的位置与方向，预览只显示图片。选择图片和调整构图只影响 Mac 草稿，点击“应用并重启阅读器”后才更换实体屏保。

支持 macOS 15 及以上，当前构建为 Apple Silicon。

1. 阅读器与 Mac 连接同一 Wi-Fi，在阅读器打开新版「AI 用量」。接收端需获 Magisk Root 授权。
2. Mac 打开「小米屏保」，选择图片，点击「应用并重启阅读器」。
3. 阅读器收到图片后安装资源模块，**自动重启一次**，随后校验系统加载的图片像素。Mac 显示校验结果后，按电源键查看休眠屏保。
4. 「恢复系统原屏保（重启）」会停用该模块并重启。原厂屏保资源保留。

这版固件的原生 setter 无法显示自定义图片；2.0 使用只含资源、无可执行代码的 Magisk 静态覆盖模块 `mibook_screensaver`。系统日历由固件另外绘制，图片替换保留该显示逻辑。每次更换／恢复都需要重启，离线时任务保留，唤醒并打开「AI 用量」后接收。重启后自动尝试回传校验；若 Mac 长时间等待，开机后打开「AI 用量」补发回执。

传输继续使用现有配对令牌，未开启无线 ADB。接收端校验模块与 APK 摘要、模块文件白名单、指定包名及无代码／无权限属性，然后仅执行模块安装、停用和重启。原有额度同步仍独立运行。

用户图片和模块产物保存在 `.state/screensaver/`，不改写选中的原图。Mac 工具读取构建时项目目录下的配对信息；项目移动后需重建。Mac 同步服务编译覆盖包需要本机的 OpenJDK 17、Android SDK 34，以及现有 `.state/display.keystore`。

```sh
bash scripts/build-mac-screensaver.sh
bash scripts/test-mac-screensaver.sh
bash scripts/build.sh
.tools/platform-tools/adb install --no-streaming -r dist/codex-usage.apk
launchctl kickstart -k gui/$(id -u)/dev.mibook.codexusage.sync
open dist/小米屏保.app
```

只适配上述确切型号和固件，不用于其他设备。原生路径故障和适配证据见 [固件排查记录](../macos/SCREENSAVER-FIRMWARE.md)，Root 备份与恢复包见 [Root 恢复记录](../macos/ROOT-RECOVERY.md)。

## 文件

- `android/`：原生 Java 应用源码，无第三方 Android 依赖。
- `bridge/`：Mac 数据读取与 Wi-Fi 同步程序，无 npm 依赖。
- `bridge/wifi.mjs`：有配对校验的局域网用量服务。
- `dist/codex-usage.apk`：可安装 APK。
- `.state/`：本地签名密钥、用量快照和同步日志，不应提交到版本库。保留签名密钥以便后续覆盖升级。
- `.tools/platform-tools/`：Google 官方 ADB 工具。

## 构建与安装

本机使用 Homebrew 的 OpenJDK 17 和已有 Android SDK 34：

```sh
bash scripts/build.sh
.tools/platform-tools/adb install -r dist/codex-usage.apk
node scripts/install-sync.mjs
node scripts/install-claude.mjs
node scripts/pair-wifi.mjs
```

`install-sync.mjs` 安装当前用户登录时启动的 LaunchAgent：`~/Library/LaunchAgents/dev.mibook.codexusage.sync.plist`。源码保留在本目录，移动目录后需要重新安装该同步服务。

`MIBOOK_SERIAL`、`MIBOOK_ADB` 可覆盖配对脚本的设备序号和 ADB 路径；`MIBOOK_CODEX` 可覆盖同步程序的 Codex 路径。构建脚本支持 `MIBOOK_JAVA_HOME`、`MIBOOK_ANDROID_SDK`。`node bridge/sync.mjs --once` 只刷新 Mac 快照，不向 USB 推送。

停止并移除 Mac 自动同步：

```sh
bash scripts/stop-sync.sh
```

验证：

```sh
node --test bridge/*.test.mjs
bash scripts/test-android.sh
.tools/platform-tools/adb shell dumpsys activity activities
launchctl print gui/$(id -u)/dev.mibook.codexusage.sync
```

用量字段依据 [OpenAI App Server 官方文档](https://learn.chatgpt.com/docs/app-server)。显示的是登录账户的配额百分比，不是 API 账单或剩余 Token 数。当前仅显示 `codex` 配额桶；如果账号另有独立配额桶，需要另行增加界面。


旧版仅验证了 `dumpsys power` 的超时参数，并未证明可以实际自动休眠；本机固件的屏幕重绘会持续更新 `mLastUserActivityTimeNoChangeLights`，因此参数正确仍可能一直不休眠。2.0.1 改用独立闲置计时配合系统休眠指令；计时取消、用户操作重置、唤醒重新计时均有虚拟时钟回归测试。

2026-10-29 真机完整 5 分钟静置验证（台北时间）：2.0.1 于 20:04:51 回到前台，期间正常刷新时钟及用量且没有触摸／按键；20:09:51.756 触发独立闲置计时，20:09:52.959 系统记录 `Going to sleep due to sleep button`，随后 `dumpsys power` 确认 `mWakefulness=Asleep`、`Display Power: state=OFF`。本次验证是实际系统休眠，不以超时参数或屏幕截图代替结果。自动休眠开关保留开启，全局超时保持原值。
