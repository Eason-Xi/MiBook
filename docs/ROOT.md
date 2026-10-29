# 小米多看 Pro：Root、备份与恢复完整流程

这是一台实测设备的方法记录与可复现工具，**不是所有小米阅读器的通用刷机教程**。本项目实际通过原厂 Recovery 的签名 ZIP sideload 写入 boot；没有使用其他型号的 boot、FEL 固件或替换 recovery。

## 0. 先核对适用范围与恢复条件

| 项目 | 本机实测值 |
| --- | --- |
| 型号 | `MiDuoKanReaderPro` |
| 设备代号 | `virgo-perf1` |
| 系统 | Android 8.1 / API 27 |
| 固件 | MiReaderPro `1.1.15.220615` |
| build incremental | `20220615-182206` |
| build display | `OPM1.171019.026.20220615-182206 test-keys` |
| CPU | 32 位 ARM / `armeabi-v7a` |
| boot 与 recovery 分区 | 各 33,554,432 字节（32 MiB） |
| 实测 Magisk | 31.1 |

```sh
adb shell getprop ro.product.model
adb shell getprop ro.product.device
adb shell getprop ro.build.version.sdk
adb shell getprop ro.build.version.incremental
adb shell getprop ro.build.display.id
adb shell getprop ro.product.cpu.abi
```

下列 `adb` 均指已安装并授权的 Android platform-tools；多设备请给每条命令加 `-s 你的设备序号`。本项目不自动执行任何刷写命令。生成 ZIP 不等于已经执行 ZIP，也不等于设备一定能启动。

Root 会写启动分区，可能导致无法启动、影响 OTA 或需要恢复数据。先备份个人书籍和共享存储，并准备自己的原始 boot 恢复包。本机已验证 `adb reboot recovery` 与原厂 Recovery 的 sideload 能力，但 **Android 不能启动时的物理按键进入 Recovery 方法尚未验证**；恢复包存在不代表可以处理所有变砖情况。若不能接受这一恢复边界，不应执行第 6 节。

## 1. 准备工作目录、备份共享存储、核对 OTA 证书

在仓库根目录执行：

```sh
mkdir -p .state/root/local/backups .state/root/local/packages
adb devices
adb pull /sdcard .state/root/local/backups/shared-storage
adb pull /system/etc/security/otacerts.zip .state/root/local/otacerts.zip
unzip -p .state/root/local/otacerts.zip testkey.x509.pem > .state/root/local/device-ota.pem
openssl x509 -in .state/root/local/device-ota.pem -noout -subject -fingerprint -sha256
```

本机证书 SHA-256 指纹是：

```text
A4:0D:A8:0A:59:D1:70:CA:A9:50:CF:15:C1:8C:45:4D:47:A3:9B:26:98:9D:8B:64:0E:CD:74:5B:A7:1B:F5:DC
```

证书、型号或固件不一致时不要继续。本机引导锁相关属性为空，不能据此断言任意设备已解锁；本流程的证据仅限上述设备实际接受 Recovery 包并成功启动。共享存储备份不包含普通 ADB 无法读取的全部应用私有数据。

## 2. 下载校验过的上游工具

```sh
python3 scripts/prepare-root-deps.py
```

脚本只下载、校验和转换公用测试签名材料，不连接或修改设备。下载失败或摘要不匹配时停止。下载清单：

| 文件 | 上游 | SHA-256 |
| --- | --- | --- |
| Recovery 参考 ZIP | qwerty12 / inkPalm-5-EPD105-root | `0f56d5c785c738e1f6437dfdbfe7c79ded54089dfc7e6df67fcda53610e7e8a7` |
| 公开 AOSP testkey PKCS#8 | 同上 | `495675d32e89a149d5abe191f4e9c0e218b9068714e9b53a7c91e164a0741a23` |
| 官方 Magisk 31.1 APK | topjohnwu / Magisk | `89cefac0a318afa39fb3880c45c87b036c05bc1ebf02a7a715b7f8d7c26ac6e7` |

参考 ZIP 仅用于提取现成的 ARM Recovery `update-binary`；不直接刷原项目给其他型号的脚本或镜像。此二进制是上游第三方预编译文件，内容摘要被固定，但不是本仓库从源代码构建的产物。签名依据来自 [上游作者的原始说明](https://github.com/qwerty12/inkPalm-5-EPD105-root)。下载的 AOSP 测试密钥是早已公开的测试材料，不能作为你自己的生产凭据。

验证下载的公开测试密钥确实对应自己设备证书的公钥：

```sh
openssl x509 -in .state/root/local/device-ota.pem -pubkey -noout > .state/root/local/device-ota-public.pem
openssl pkey -in .state/root/local/deps/public-aosp-testkey.pem -pubout > .state/root/local/testkey-public.pem
cmp .state/root/local/device-ota-public.pem .state/root/local/testkey-public.pem
```

公钥必须一致。`root-recovery-package.py` 会使用你设备提取的证书生成整包 CMS 签名，并在输出前验证签名；不会执行 ADB 或刷写设备。

## 3. 先导出自己的原始 boot / recovery

```sh
python3 scripts/root-recovery-package.py backup .state/root/local/packages/backup-signed.zip
cat .state/root/local/packages/backup-signed.updater-script.txt
```

先审阅生成脚本：必须只核对设备，挂载 system，并用设备自己的 toybox 将 boot / recovery 复制到 `/system/mibook-root-backups/`。它会在 system 创建约 64 MiB 备份文件，**不会写 boot 或 recovery 分区**，因此需要足够可用空间。脚本不改写 SELinux 模式。

准备执行时：

```sh
adb reboot recovery
```

在实体阅读器的原厂 Recovery 中选择 **Apply update from ADB**，再执行：

```sh
adb sideload .state/root/local/packages/backup-signed.zip
```

确认 Recovery 显示执行成功，再选择重启系统。回到 Android 后拉取文件并核对大小、摘要：

```sh
adb pull /system/mibook-root-backups/boot.original.img .state/root/local/backups/boot.original.img
adb pull /system/mibook-root-backups/recovery.original.img .state/root/local/backups/recovery.original.img
adb shell 'sha256sum /system/mibook-root-backups/boot.original.img /system/mibook-root-backups/recovery.original.img'
wc -c .state/root/local/backups/boot.original.img .state/root/local/backups/recovery.original.img
shasum -a 256 .state/root/local/backups/boot.original.img .state/root/local/backups/recovery.original.img
```

两个文件均应为 32 MiB，Mac 摘要与设备摘要一致。保留自己的备份到另一个安全位置。仓库没有提供作者设备的原始或修补后镜像。

## 4. 在刷写之前生成原始 boot 恢复包

```sh
python3 scripts/root-recovery-package.py flash .state/root/local/packages/restore-original-boot-signed.zip \
  --boot .state/root/local/backups/boot.original.img
unzip -p .state/root/local/packages/restore-original-boot-signed.zip boot.img | shasum -a 256
shasum -a 256 .state/root/local/backups/boot.original.img
cat .state/root/local/packages/restore-original-boot-signed.updater-script.txt
```

包内 `boot.img` 必须与自己的原始备份完全一致，生成脚本只允许写 `/dev/block/by-name/boot`。此时只是准备恢复包，不要把恢复包和 Magisk 安装包混淆。

## 5. 用官方工具修补自己的 boot

[Magisk 官方安装说明](https://topjohnwu.github.io/Magisk/install.html) 要求使用自己的镜像。下面记录本项目实际采用的 ARMv7 `boot_patch.sh` 路径；它只处理临时目录里的镜像文件，不写分区。

在 Mac 从经过校验的 APK 提取工具：

```sh
mkdir -p .state/root/local/patch-work
unzip -p .state/root/local/deps/Magisk-v31.1.apk assets/boot_patch.sh > .state/root/local/patch-work/boot_patch.sh
unzip -p .state/root/local/deps/Magisk-v31.1.apk assets/util_functions.sh > .state/root/local/patch-work/util_functions.sh
for binary in magisk magiskboot magiskinit init-ld busybox; do
  unzip -p .state/root/local/deps/Magisk-v31.1.apk "lib/armeabi-v7a/lib${binary}.so" > ".state/root/local/patch-work/$binary"
done
cp .state/root/local/backups/boot.original.img .state/root/local/patch-work/boot.original.img
adb push .state/root/local/patch-work /data/local/tmp/mibook-patch
adb shell 'cd /data/local/tmp/mibook-patch && chmod 755 busybox magisk magiskboot magiskinit init-ld && BOOTMODE=true ASH_STANDALONE=1 KEEPVERITY=true KEEPFORCEENCRYPT=true PATCHVBMETAFLAG=false RECOVERYMODE=false PREINITDEVICE=cache TMPDIR=/data/local/tmp/mibook-patch ./busybox sh ./boot_patch.sh boot.original.img'
adb pull /data/local/tmp/mibook-patch/new-boot.img .state/root/local/backups/boot.magisk.img
```

`KEEPVERITY`、`KEEPFORCEENCRYPT` 保持 true，`RECOVERYMODE` 为 false，`PREINITDEVICE=cache` 是本机实测配置，不应照搬到其他型号。工具报错或没有正常生成新镜像时停止。

核对新旧镜像都是 32 MiB、标准 Android boot，内核字节和主要启动参数没有意外改变：

```sh
python3 - <<'PY'
from pathlib import Path
import hashlib, struct
folder = Path('.state/root/local/backups')
a = (folder / 'boot.original.img').read_bytes()
b = (folder / 'boot.magisk.img').read_bytes()
assert len(a) == len(b) == 33554432
assert a[:8] == b[:8] == b'ANDROID!'
for offset, count in [(12, 4), (20, 4), (28, 12), (44, 532), (608, 1024)]:
    assert a[offset:offset + count] == b[offset:offset + count], 'Boot parameters changed'
def kernel(image):
    size = struct.unpack_from('<I', image, 8)[0]
    page = struct.unpack_from('<I', image, 36)[0]
    assert page in (2048, 4096, 8192, 16384) and 0 < size < len(image) - page
    return image[page:page + size]
assert kernel(a) == kernel(b), 'Kernel changed'
print('Boot header and kernel checks passed')
print('Patched SHA-256:', hashlib.sha256(b).hexdigest())
PY
```

本机另外解包 ramdisk，核对替换的 init 与 APK 中官方 `magiskinit` 一致、原 init 备份存在，以及 `.backup/.magisk` 配置符合上述设置。完整历史检查项目见 [Root 恢复记录](../macos/ROOT-RECOVERY.md)。这些检查减少误刷风险，不保证任何设备都能启动。

## 6. 生成并安装修补后的 boot 包

只有原始备份、恢复包和新镜像检查都完成后才执行：

```sh
python3 scripts/root-recovery-package.py flash .state/root/local/packages/install-magisk-boot-signed.zip \
  --boot .state/root/local/backups/boot.magisk.img
cat .state/root/local/packages/install-magisk-boot-signed.updater-script.txt
unzip -p .state/root/local/packages/install-magisk-boot-signed.zip boot.img | shasum -a 256
shasum -a 256 .state/root/local/backups/boot.magisk.img
adb reboot recovery
```

再次在设备选择 **Apply update from ADB**，然后：

```sh
adb sideload .state/root/local/packages/install-magisk-boot-signed.zip
```

确认 Recovery 端成功，再重启 Android。这个包有型号／固件断言，只写 boot，不写 recovery、bootloader、分区表或 userdata。不要从 README 之外寻找“其他型号通用镜像”来替代自己的备份。

## 7. 完成 Magisk 初始化与验证

```sh
adb install .state/root/local/deps/Magisk-v31.1.apk
```

打开 Magisk，按其提示完成环境修复并等待自动重启。在 **Superuser** 页面事先允许需要的「Shell」和「AI 用量」。[Magisk 31.1](https://github.com/topjohnwu/Magisk/releases/tag/v31.1) 改为预先授权，不应一直等待调用时弹出授权窗口。

```sh
adb shell su -c id
adb shell su -c 'magisk -v'
adb shell getenforce
adb shell su -c 'sha256sum /dev/block/by-name/boot /dev/block/by-name/recovery'
```

预期 `id` 显示 uid 0；本机 SELinux 保持 `Enforcing`；实际 boot 摘要应与自己修补后镜像相同，实际 recovery 摘要仍与原始备份相同。APK 安装完成或 ADB 传输到 100% 不能代替这些验证。

然后按 [安装文档](SETUP.md) 配对「AI 用量」，按 [屏保文档](SCREENSAVER.md) 更换屏保。

## 8. 恢复原屏保或撤回 Root

- 只恢复屏保：Mac 点击“恢复系统原屏保（重启）”，或在 Magisk 停用 `mibook_screensaver` 后重启。
- 撤回 Root：先停用屏保模块并确认原图恢复，再在原厂 Recovery 的 **Apply update from ADB** 中 sideload 你自己的 `restore-original-boot-signed.zip`，成功后重启。
- Root 后不能启动：如果仍能进入原厂 Recovery，可尝试同一个原始 boot 恢复包。该包只能修复相关 boot 改动，不能替代完整出厂救砖固件，也不能修复任意分区损坏。

不要上传自己的共享存储、原始／修补镜像、个人图片或完整设备日志。所有示例工作目录都在已忽略的 `.state/` 下。
