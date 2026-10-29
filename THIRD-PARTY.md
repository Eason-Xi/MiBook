# 第三方来源与归属

本仓库不捆绑 Android SDK、厂商固件、Magisk 二进制、个人 boot 镜像或上游 Recovery 二进制。需要的工具按各自上游方式获取，并遵循对应许可。

| 项目 | 本项目用途 | 来源 |
| --- | --- | --- |
| Magisk 31.1 | 本机 boot 修补、Root、可停用资源模块 | [官方项目](https://github.com/topjohnwu/Magisk)、[31.1 发行](https://github.com/topjohnwu/Magisk/releases/tag/v31.1)、[安装说明](https://topjohnwu.github.io/Magisk/install.html)；许可以该版本上游仓库为准 |
| qwerty12 / inkPalm-5-EPD105-root | Recovery 签名思路、现成 ARM `update-binary` 与公开 AOSP 测试签名材料的下载来源 | [原始项目和文件](https://github.com/qwerty12/inkPalm-5-EPD105-root)；原始目标设备不同，只借用已核对摘要的工具，不直接套用其镜像或脚本 |
| Android SDK / AOSP | ADB、aapt、d8、apksigner、Android API；公开 Android 测试证书是设备固件既有签名配置 | [Android 开发工具](https://developer.android.com/tools)、[AOSP](https://source.android.com/) |
| OpenAI Codex CLI | 账户额度读取 | [官方 CLI](https://developers.openai.com/codex/cli/)、[App Server](https://developers.openai.com/codex/app-server/) |
| Anthropic Claude Code | `/usage` 与 statusLine 额度采集 | [官方 setup](https://code.claude.com/docs/en/setup)、[statusLine](https://code.claude.com/docs/en/statusline) |

厂商屏保资源和用户图片的权利归各自权利人。个人测试照片、插画、阅读器截图与厂商资源 APK 没有作为仓库素材再分发。Root 参考包与公开测试密钥只在本机下载到忽略目录，不是本项目的私有生产签名材料。
