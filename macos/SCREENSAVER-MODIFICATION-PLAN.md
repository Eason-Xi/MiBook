# 小米多看 Pro 屏保修改方案（历史审批稿）

> 状态更新（2026-10-29）：用户已批准并完成 Root，boot／recovery 已备份，屏保模块已在实体设备确认显示，停用模块恢复原资源也已通过。以下保留执行前的评估内容；当前状态以 [Root 恢复记录](ROOT-RECOVERY.md)、[固件适配记录](SCREENSAVER-FIRMWARE.md) 和 README 为准。


日期：2026-10-29。目标是 Mac 经 Wi-Fi 更换实体电源键休眠后显示的图片。

## 结论

目前不能承诺 root 后一定成功。建议先核实本机官方更新；如没有合适更新，再分阶段验证“本机启动镜像备份 → root → 可移除屏保资源模块”。不直接替换 system 的核心服务，不套用 Pro II 镜像。

## 本机只读核实结果

| 项目 | 结果 |
| --- | --- |
| 型号 / 设备 | MiDuoKanReaderPro / virgo-perf1 |
| 平台 | Allwinner / sun8iw15p1 / AW_b300，32 位 ARM |
| 系统 / 产品版本 | Android 8.1 / MiReaderPro 1.1.15.220615 |
| 固件 | OPM1.171019.026.20220615-182206 test-keys |
| ADB | 普通 shell；ro.debuggable=0、ro.secure=1；未发现 su |
| 引导锁状态 | 常见 verifiedboot/flash.locked 属性为空，不能据此断言已解锁 |
| boot / recovery | 各 32 MiB，分别为 mmcblk0p4 / mmcblk0p8；普通 shell 不可读 |
| system / vendor | 独立 ext4 分区，均以只读方式挂载 |
| 用户数据 | 系统报告 unencrypted，已用约 3.1 GiB；不代表恢复环境一定可访问 |
| 屏保限制 | showCustomWallPaper() 恒返回 false；setter 只保存属性 |

原有屏保覆盖 APK 已只读备份到 `.state/screensaver-research/20261029/framework-res__auto_generated_rro.original.apk`（1,367,555 字节）。
SHA-256：`2e0fee20aab42da5ad8851a612b49e2317b810787d4ee5c98247d39b464c4997`。
**boot 和 recovery 尚未备份，当前没有已验证的完整救砖包。**

## 第一阶段：先核实官方更新

查验设备自己的系统更新功能，记录本机提供的版本和更新说明；先不安装。
[屏保修改教程作者的后续回复](https://ximin.top/blog/140.html) 提到其 1.1.17 版本可以设置固定图片，但没有足够证据证明该版本号适用于本机 Pro。
如果官方提供本机适配、确实支持自定义屏保的更新，优先评估更新后复用现有 Mac 图片传输功能。

## 第二阶段：验证备份与恢复入口（另行确认后才执行）

1. 先备份用户书籍及可导出的设置到 Mac，核实备份大小与可读性。暂不清除数据。
2. 记录并实测本机进入原厂 Recovery 的方法，尤其是 Android 无法正常启动时的物理进入方式。
3. 准备针对本机的 Recovery 启动镜像导出包，静态审阅其中全部脚本；备份本机 boot，拉到 Mac 并计算 SHA-256。
4. 用该原厂 boot 准备回刷包，审阅其目标必须是本机 `/dev/block/by-name/boot`，再核对恢复入口可用。

这一阶段**不是纯只读操作**。已找到的旧款方案通过原厂 Recovery 挂载 system，并创建 `/system/bimg.img` 导出 boot，因此会写入一个约 32 MiB 文件到 system，可能影响 OTA 或完整性校验。只有用户确认这一明确范围后才实施。

现有参考包来自 [qwerty12/inkPalm-5-EPD105-root](https://github.com/qwerty12/inkPalm-5-EPD105-root)，仅下载并静态检查，未运行或 sideload。

- 参考包 SHA-256：`0f56d5c785c738e1f6437dfdbfe7c79ded54089dfc7e6df67fcda53610e7e8a7`。
- 本机 OTA 认可证书和参考包证书 SHA-256 一致：`A40DA80A59D170CAA950CF15C18C454D47A39B26989D8B640ECD745BA71BF5DC`。
- 已用 OpenSSL 检查参考包整包 CMS 签名，结果通过。证书一致和签名正确不等于已经证实 Recovery 会接受，更不等于本机执行安全。
- 脚本仅包含挂载 system 和把本机 boot 复制到 `/system/bimg.img` 两条指令；包内还含第三方 ARM 原生 updater 二进制，尚未核实其构建来源。
- 参考包 metadata 标记的是 2021 年版本，本机为 2022 年版本，**不能原样照搬并声称已适配**。准备执行包前必须解决 metadata、恢复环境及原生 updater 的适配审查。

如果备份、校验、回刷包或独立 Recovery 入口有任何一项无法确认，停在此阶段，不继续 root。

## 第三阶段：root 与屏保资源模块（再次确认后才执行）

1. 根据导出的本机 boot 是否含 ramdisk，核对 Magisk 的适用安装路径及兼容版本。
2. 使用本机的原厂镜像进行修补，保留原厂和修补后的两份文件。遵循 [Magisk 官方要求](https://topjohnwu.github.io/Magisk/install.html)，不使用其他人分享的预修补镜像。
3. 用户确认 root 及启动分区写入范围后，才考虑安装修补后的 boot。
4. 尝试制作可移除模块，把一个新增静态屏保覆盖 APK 映射到 `/vendor/overlay/`，仅替换实际使用的 photo5–photo8 及横屏/充电变体。优先用系统挂载覆盖方式，不直接覆盖原 vendor APK，不修改 services.odex/framework.jar。
5. 重启后验证系统确实识别覆盖，再由用户观察实体电源键休眠后的画面。资源缓存、日期文字叠加和横竖屏布局仍需真机验证。

模块挂载方案是依据本机资源路径提出的设计，目前未经 root 后真机验证。

## Wi-Fi 与恢复

root 成功后可继续使用现有配对 HTTP 通道传图，由权限范围明确的设备端组件更新屏保模块。具体更新方式、签名与重启需求需验证；不预先承诺即时刷新，也不以开启网络 ADB 作为默认方案。

正常启动时，禁用或移除模块并重启，应撤销资源映射。若 root 导致启动失败，计划通过已验证的原厂 Recovery 回刷本机原厂 boot；恢复原 boot 后模块不会继续由 Magisk 挂载。是否能恢复仍依赖前述入口和备份，不能保证无损或完全免于救砖风险。

主要风险为启动失败、数据丢失、OTA 受影响，以及新增 root 权限。现阶段只研究并备份了普通可读文件，没有 root、重启至 Recovery、刷写启动分区或更改系统分区。

## 当前建议

先只检查官方更新并完成 Recovery/备份方案的离线审查。不要现在批准一次性 root 和刷写；等第二阶段的适配包、恢复步骤和数据备份准备完整后，再按明确范围确认。
