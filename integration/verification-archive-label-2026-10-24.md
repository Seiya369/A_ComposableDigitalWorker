# 自动归档精简文案验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.9.2` 最终物理归档。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.9.2.tgz](../artifacts/dsh-plugin-composable-workforce-0.9.2.tgz) |
| SHA-256 | `e37efee1db1f5c9354df374c09c407d1aacf78385a24745b753be88430dec0c1` |
| 校验文件 | [SHA-256](../artifacts/dsh-plugin-composable-workforce-0.9.2.tgz.sha256) |
| 大小／文件数 | 908,491 字节／291 个文件 |
| 环境 | 官方 DSH `0.2.1-alpha.2`、Node `24.21.0`，独立临时 profile |
| 安装、卸载、许可 | [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

任务档案、复盘经验、工作约束三处“开启自动归档”精简为“自动归档”。保留“开关＋文字”的顺序和既有整组右对齐，文案缩短后开关随之右移；不改字号、灰色、开关尺寸、状态或保存逻辑。当前说明和更新记录同步修改，历史验收保留。

## 验证

- 构建、类型检查通过：[构建日志](../artifacts/archive-label-validation/build.log)、[类型日志](../artifacts/archive-label-validation/typecheck.log)。相关 UI 单元测试 **10／10** 通过：[日志](../artifacts/archive-label-validation/targeted-unit.log)。本次不涉及业务逻辑，未重复运行上一版全量单元测试。
- 最终实包 **52 项 UI 检查一轮全部通过**。三处文案均为“自动归档”，桌面、窄屏和短窗口均验证开关在文字左侧、整组与卡片内右边缘误差为 **0px**；开关高度仍为 **11.2px**，原灰色、归档保存／隔离、默认模型页、AI 智填、图谱和严格增量检查均保留：[结果](../artifacts/archive-label-validation/employee-settings-result.json)、[归档绑定](../artifacts/archive-label-validation/ui-archive-binding.json)、[日志](../artifacts/archive-label-validation/ui-e2e.log)、[四卡原生截图](../artifacts/archive-label-validation/employee-settings-archive-cards-dark.png)。测试使用隔离离线模型。
- 最终实包 **13 项官方生命周期检查通过**，安装、普通卸载、重装、完全清理及原生宿主恢复通过；12 个知识文件普通卸载重装前后逐字节一致：[报告](../artifacts/lifecycle-0.9.2/report.json)、[日志](../artifacts/lifecycle-0.9.2/lifecycle.log)。临时浏览器、宿主、Wiki 子进程和 profile 均已清理。
- 官方宿主 **28,401 个程序文件**前后完整联合 SHA-256 一致：`401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。未修改官方宿主文件。
- 归档 **291 个文件**与源码／构建逐字节一致，不含宿主补丁、用户数据、凭据或测试夹具：[白名单核对](../artifacts/archive-label-package-inventory.json)。
- 当前 3081 实际界面三处文案及右对齐已生效，原三个开关仍为开启状态；本轮未修改或保存用户配置、未调用模型，完整员工状态与基线一致：[CUA 结果](../artifacts/archive-label-validation/live-cua-result.json)、[状态完整性](../artifacts/archive-label-validation/live-state-integrity.json)、[实际页面](../artifacts/archive-label-validation/live-archive-label.png)。

正式报告均绑定以上最终归档哈希，验收后未重新打包。
