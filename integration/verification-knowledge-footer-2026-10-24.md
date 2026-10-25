# 认知记忆底部说明验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.6.2` 的最终归档。本次只恢复认知记忆底部紧凑单行说明：

> 影子员工资料管理：A 原始资料 > B 详细知识 > C 概念综述

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.6.2.tgz](../artifacts/dsh-plugin-composable-workforce-0.6.2.tgz) |
| SHA-256 | `364d474c4815c52f4bebcbabde90c3905258991639e08363f48d1eb5d65320fa` |
| 大小／文件数 | 899,343 字节／285 个文件 |
| 兼容验证 | 官方 DSH `0.2.1-alpha.2`，独立临时 profile |
| 安装卸载／许可 | 随包 [说明](README.md)、许可证、固定共享 Wiki 源码和依赖锁 |

说明位于图谱区域下方，11px 字号、18px 行高，保持单行；超窄区域以省略号处理且完整文字可通过 title／可访问文本读取。既有四类、开关、图谱及资料功能保持。

- 构建通过。既有物理归档浏览器验收 30／30，通过桌面、窄屏和矮窗中的精确文本、可见、单行、紧接主图下方及 17–20px 高度检查；[结果](../artifacts/knowledge-footer-validation/employee-settings-result.json)、[日志](../artifacts/knowledge-footer-validation/e2e.log)。
- 3081 实际页面可见完整说明，计算字号 11px、行高 18px，真实文本占一行；[实际计算值](../artifacts/ui/knowledge-footer-live-metrics.json)、[实际截图](../artifacts/ui/knowledge-footer-live.jpg)。
- 原始资料、知识快照 v3 与归档设置逐对象保持一致；[核对结果](../artifacts/ui/knowledge-footer-live-result.json)。
- 官方独立 profile 安装、核心功能、普通卸载、重装、完整清理及原生宿主验证 13 项通过，知识目录前后 12 个文件逐字节一致；[报告](../artifacts/lifecycle-0.6.2/report.json)。
- 官方程序 28,401 个文件前后联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`，未修改宿主。
- [白名单核对](../artifacts/knowledge-footer-package-inventory.json)未发现宿主补丁、宿主构建物、安装目录、用户数据、凭据或测试夹具。归档源码及相关构建与实际被验工作区逐字节相同，验收后未重新打包。

本次为低影响文案与样式修改，沿用 [0.6.0](verification-archive-controls-2026-10-24.md) 全量单元结果，不新写文案镜像单测。
