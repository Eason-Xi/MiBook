# 本机 root 与恢复记录

适用：MiDuoKanReaderPro / virgo-perf1 / MiReaderPro 1.1.15.220615。
日期：2026-10-29。其他型号、其他固件不能使用这些镜像。

## 当前进度

用户已授权 root。共享存储、原始 boot、原始 recovery 均已备份。
**Root 已完成并验证。** Magisk 31.1 已安装，首次运行环境修复及自动重启已完成。Shell 经 Magisk 授权后，`su -c id` 返回 `uid=0(root) gid=0(root) groups=0(root) context=u:r:magisk:s0`。

实际 boot 分区 SHA-256 与本机修补镜像一致；实际 recovery 分区 SHA-256 与原始备份一致。SELinux 仍为 Enforcing。Shell 与屏保接收端「AI 用量」均已验证可执行 Root 命令。已安装可停用的屏保资源模块 `mibook_screensaver`，模块只覆盖 `/vendor/overlay/MiBookScreensaver.apk`，不改写原厂 framework-res.apk。实体休眠屏幕已由用户确认显示自选插画。

## 已验证的备份

文件都位于项目的 `.state/root/20261029/`：

- `backups/shared-storage/`：2,285 个文件、930,516,329 字节；SHA-256 清单在 `backups/shared-storage-manifest.json`。这是共享存储备份，不包含普通 ADB 无法读取的全部应用私有数据库。
- `backups/boot.original.img`：33,554,432 字节，SHA-256 `098395fe73a3c9b126617278b7425b4dd15b9d5b73130d8d3c0c67c2e741130b`。
- `backups/recovery.original.img`：33,554,432 字节，SHA-256 `5b0e64d6af9528c476a4cd72b6a54e9379f9f3fa7c8978d78be7170628899d7b`。

boot/recovery 的 Mac 文件摘要与设备端原始导出文件一致。
导出包已在原厂 Recovery 执行完成，设备随后正常启动。该包只创建 `/system/mibook-root-backups/` 中的两个文件，没有写 boot/recovery 分区。

## 原厂恢复包

`packages/restore-original-boot-signed.zip`，SHA-256
`3f45a0178d523b764f161f620d262c7762609165b71d4462fadf4d8c2172438b`。

恢复包内的 boot.img 与原始备份逐字节一致。使用本机认可的公开 Android 测试证书签名；整包 CMS 签名已验证。设备下载目录也存有一份 `MiBook-restore-original-boot-signed.zip`。

如刷入 Magisk boot 后不能正常启动，应先回到原厂 Recovery 的 Apply update from ADB，再由 Mac 发送上述原厂恢复包。恢复包仅写 `/dev/block/by-name/boot`；不能保证适用于其他类型的损坏，也不能替代完整出厂救砖包。

当前已验证的是 ADB 重启到原厂 Recovery 及其 sideload 执行能力，尚未实测 Android 不可启动时的物理进入方式。不要把恢复包存在等同于无条件可救砖。

## 已刷入的修补镜像及安装包

`backups/boot.magisk.img`：33,554,432 字节，SHA-256
`ec6dcf48a6a665989c3805f7c0aa51f3ca44b4e0684bad5caa007c3adabf0cc4`。

使用官方 Magisk 31.1 APK 中的 ARMv7 工具，在本机临时目录执行 boot_patch.sh 生成。
已验证内核字节、启动地址、OS 版本和启动参数未改变，ramdisk init 与官方 magiskinit 二进制一致，并包含 Magisk 运行文件及原 init 备份。
配置保留 KEEPVERITY=true、KEEPFORCEENCRYPT=true；PREINITDEVICE=cache。
完整检查记录在 `patched-boot-verification.json`。

`packages/install-magisk-boot-signed.zip`，SHA-256
`ff4334dfd2efb72ea85f9dba7e145a7a595a205f0ea0579e88a1f8b07526a4b0`。
包内镜像与上述修补镜像逐字节一致，整包签名已验证，仅写 boot 分区。
两个刷写包都会先核对设备代号、型号和固件版本。

所有步骤的机器可读状态以 `.state/root/20261029/progress.json` 为准；不能以 sideload 传输完成代替设备端执行成功，也不能以 APK 安装完成代替 root 验证。

## 屏保模块恢复

在 Mac「小米屏保」点击「恢复系统原屏保（重启）」，接收端会创建模块的 `disable` 标记并重启。也可在 Magisk 模块页面停用 MiBook Screensaver 后重启。

这条恢复路径仅撤回屏保模块。原始 boot 恢复包用于撤回 Root，不能混同；如果要撤回 Root，应先停用屏保模块并确认系统原图恢复。
