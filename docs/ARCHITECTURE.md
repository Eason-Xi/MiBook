# 架构、数据与验证

## 组件

```text
已登录的 Codex CLI ── account/rateLimits/read ──┐
                                             ├─ Mac Node 服务 ── 配对 Wi-Fi ── Android AI 用量
已登录的 Claude Code ── PTY /usage 面板 ───────┘         │
                                                       │
Mac SwiftUI 编辑器 ── localhost + 配对令牌 ──────────────┘
       图片编辑 → 数据资源 APK → Magisk ZIP → 阅读器校验 → 重启 → 系统资源像素校验
```

Node 服务不依赖 npm 包；Android 为原生 Java，无第三方运行库。Mac App 依赖系统 SwiftUI / AppKit。

Codex CLI 额度查询不会启动模型任务。Claude 主动刷新会先检查 CLI 登录状态，在隔离 PTY 中执行 `/usage`，不发送模型提示词；另保留 statusLine 采集器。保存内容只含额度、重置时间、观测时间，不保存终端正文或身份字段。

## 网络与身份

Mac 在 48763 提供本地 HTTP 服务，Bonjour `_mibookusage._tcp` 发现地址；阅读器保留最后成功地址。每次访问检查随机 32 字节配对令牌。图片上传／默认屏保操作仅允许 Mac 本机发起，阅读器通过同一配对通道轮询任务、下载与回执。

协议为局域网 HTTP；配对令牌用于认证，不提供传输加密。请在可信局域网使用，不开放公网端口。OpenAI、Anthropic 登录信息继续由 Mac CLI 管理，阅读器没有这些账户凭据。

## 休眠

单靠窗口 `userActivityTimeout=300000` 在本机不可靠：固件会将分钟画面刷新记入 `mLastUserActivityTimeNoChangeLights`。2.0.1 增加独立前台闲置计时，触摸／按键重置，退出或失焦取消，回到前台重新计时。超时使用已授权的 Root 发送 `KEYCODE_SLEEP`，执行前再次检查前台、开关及操作代次；不发送电源切换键。

关闭自动休眠时保留 `FLAG_KEEP_SCREEN_ON`，不改写全局 `screen_off_timeout`，不申请设备管理员权限。

## 屏保校验

阅读器接收端限定确切型号／系统版本、模块文件白名单、数据大小、摘要、APK 包名，以及无代码／无权限属性。模块只覆盖指定屏保资源包。重启后读取系统实际资源，以未缩放尺寸和像素逐行比较，避免把“模块传输成功”误报为“系统已显示”。实体墨水屏显示仍需实际观察。

横屏编辑先生成 1872 × 1404 逻辑画布，发送前逐像素旋转成 1404 × 1872 物理资源；显示日期是固件的另一绘制层。

## 测试

```sh
node --test bridge/*.test.mjs
bash scripts/test-android.sh
bash scripts/test-mac-screensaver.sh
python3 -m py_compile scripts/root-recovery-package.py scripts/prepare-root-deps.py scripts/check-publish.py
python3 scripts/check-publish.py
```

- Bridge：Codex / Claude 字段白名单、未知额度、PTY 主动查询、失败缓存、五分钟时间表、配对认证、刷新超时、屏保协议与回执。
- Android 虚拟时钟：闲置触发、操作重置、旧任务失效、关闭取消、退出取消、前台恢复、周期刷新不续期。
- Mac：画布尺寸、灰度、裁切／留白、拖动、缩放、旋转、横屏编码、编辑参数序列化，以及编译包内八张实际图片。
- GitHub CI：Linux 上运行 Bridge 与闲置计时测试；Mac App 的图形渲染测试需 macOS 图形会话，CI 没有假装验证实体阅读器。

Root 包生成工具在 Mac 本地通过原始备份完成备份包／恢复包／安装包生成、包内镜像摘要和 CMS 签名验证；自动测试不会刷写设备。历史真机 Root、恢复与屏保证据见 `macos/` 下的记录；个人镜像和原始日志不在仓库内。
