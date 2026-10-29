# 屏保原生路径故障与 Root 适配

检查日期：2026-10-29。设备 MiDuoKanReaderPro / Android 8.1，固件
`OPM1.171019.026.20220615-182206 test-keys`。

## 已观察到的原因

用户所选图片已传入设备、可成功解码，`persist.sys.mogu.wallpaper` 已保存图片路径。
但这些事实不足以证明休眠时显示了图片。此前 1.9.0 的成功判断不成立。

从这台设备的 `/system/framework/oat/arm/services.odex` 用系统自带 oatdump
提取 PowerManagerService 的实际实现，结果保存在
`build/screensaver/power-all.txt`（普通 shell 采集证据，不是 REA Evidence）。

- `showCustomWallPaper()` 在该文件第 24477 行起只有 `const/4 v0, #+0; return v0`，即恒为 false。
- 随后的 `showSuspendLogo()` 调用它，false 时选择 `photo5`、`photo6`、`photo7`、`photo8` 内置资源，交由 `LunarCalendarView` 显示。
- `setMoguCustomerWallPaper(String)` 仅设置属性，没有改变上述显示分支。

读取 framework-res.apk 和 LunarCalendarView 的只读分析产物保存在同一 build 目录。
临时构建并安装了不含代码、无权限的 drawable 资源覆盖包，`cmd overlay list/dump`
未把该包列入可用覆盖，启用命令没有改变覆盖列表。试验包
`dev.mibook.screensaver.overlay` 已卸载，没有改写系统分区，也没有启用网络 ADB。
休眠截图为黑屏，不能作为实体墨水屏显示内容的证据。

## 1.9.1 纠正

- 接收端识别上述确切固件，在读取旧的成功缓存前返回 `unsupported_firmware`。
- Mac 透传失败原因并暂停该固件的无线应用按钮；仍可预览、适配尺寸、灰度转换和导出图片。
- 当前固件不应再宣称无线更换屏保可用。额度同步继续使用原机制。
- 保留 Mac 上用户图片；没有清除用户选择或改写其原图。

## Root 适配前的待办（历史记录）

需要继续只读核实是否存在适配本机、支持自定义休眠屏保的官方更新。
目前没有确认过任何可用目标固件，不应建议直接刷入其他型号系统。
如后续考虑修改系统，需先提供具体方案、恢复办法及影响范围，由用户确认后再实施。
实际更换功能必须在实体设备休眠后确认画面，不能再次以 setter 返回值或属性读回代替显示验证。

## 2.0 Root 路径（2026-10-29）

Magisk 静态模块已被系统识别。首次默认配置覆盖未被优先选择；匹配尺寸的资源别名又出现白屏。
最终使用 `drawable-sw748dp-hdpi` 内的八张直接 PNG，资源名与本机 photo5～photo8 及充电／横屏变体一致。`aapt --no-crunch` 保留原 PNG 的色彩信息；不使用跨包私有资源别名。

已确认 `cmd overlay list android` 中模块为启用，应用读取资源的 asset cookie 来自覆盖包。用户已在实体设备进入休眠后确认鹿和人物插画出现。这是原生 setter 路径以外的 Root 适配，不改变 `showCustomWallPaper()` 恒 false 的事实。固件仍会另绘日期层。

2.0 的成功回执需在重启后确认覆盖包摘要、启用状态、全部八张系统资源的未缩放像素与源图一致；不能用单纯的安装或 setter 返回值作为成功。模块停用后重启可恢复原系统资源。完整无线流程及恢复回归的最终状态见 `.state/screensaver/verification.json`。
