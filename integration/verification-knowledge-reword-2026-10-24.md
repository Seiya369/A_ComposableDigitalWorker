# B 层底部名称调整验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.6.3`，将认知记忆底部及其悬浮说明中的“B 详细知识”改为“B 知识重组”。完整文字为：

> 影子员工资料管理：A 原始资料 > B 知识重组 > C 概念综述

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.6.3.tgz](../artifacts/dsh-plugin-composable-workforce-0.6.3.tgz) |
| SHA-256 | `28ff93567511fc5b15847002df98f862047b375642ea8129ac6b46b158bc0736` |
| 大小／文件数 | 899,416 字节／285 个文件 |
| 官方兼容验证 | DSH `0.2.1-alpha.2`，独立临时 profile |
| 安装卸载／许可 | 随包 [说明](README.md)、许可、固定共享 Wiki 源码与依赖锁 |

- 构建通过。既有物理归档浏览器验收 30 项通过，包含桌面、窄屏与矮窗的精确文本、单行与底部可见检查；[结果](../artifacts/knowledge-reword-validation/employee-settings-result.json)、[日志](../artifacts/knowledge-reword-validation/e2e.log)。
- 实际 3081 页面文字和 title 一致，仍为 11px 字号／18px 单行；[实际读取](../artifacts/ui/knowledge-reword-live-metrics.json)、[实际截图](../artifacts/ui/knowledge-reword-live.jpg)。
- 原知识快照 v3、原始资料和开关设置逐对象保持一致；[结果](../artifacts/ui/knowledge-reword-live-result.json)。
- 官方安装、使用、普通卸载、重装、完整清理和原生宿主等 13 项通过；知识目录前后 12 个文件逐字节一致；[报告](../artifacts/lifecycle-0.6.3/report.json)。
- 官方程序 28,401 个文件前后联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。
- [包白名单核对](../artifacts/knowledge-reword-package-inventory.json)通过，不含宿主补丁、宿主构建物、安装目录、用户数据、凭据或测试夹具。核心源码和构建与本次归档逐字节核对一致，验收后未重新打包。

此次低影响文案变更沿用 [0.6.0](verification-archive-controls-2026-10-24.md) 的全量单元结果，不新增文案镜像单元测试。另纠正 README 中固定上游版本的笔误为实际 `0.6.13`，共享引擎未变。
