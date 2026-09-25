# 第三方组件声明（Third-party Notices）

本项目 `vendor/` 目录包含以下第三方组件，各自保留原始许可证：

| 组件 | 来源 | 许可证 |
| --- | --- | --- |
| v86（libv86.js / libv86.mjs / v86.wasm） | https://github.com/copy/v86 | BSD-2-Clause |
| seabios.bin / vgabios.bin | https://github.com/copy/v86 | LGPL-3.0（SeaBIOS）/ MIT（VGA BIOS） |
| buildroot-bzimage.bin | v86 项目演示镜像（Linux 内核 + BusyBox） | GPL-2.0 |
| xterm.js / xterm-addon-fit | https://xtermjs.org | MIT |
| BusyBox（镜像内） | https://busybox.net | GPL-2.0 |

镜像内运行的 Linux 内核与 BusyBox 均为 GPL-2.0 软件，镜像文件可在此仓库中再分发，
其源代码可从上游项目获取：
- Linux 内核：https://www.kernel.org/
- BusyBox：https://busybox.net/downloads/
- 构建方式：https://github.com/copy/v86 的 tools/ 目录
