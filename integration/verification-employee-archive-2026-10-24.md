# 职业人归档入口验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.10.1` 最终物理归档。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.10.1.tgz](../artifacts/dsh-plugin-composable-workforce-0.10.1.tgz) |
| SHA-256 | `32adc62076da69f15068ac0190b747294f311abc316f7dd8f0c2cc00b38b7050` |
| 校验文件 | [SHA-256](../artifacts/dsh-plugin-composable-workforce-0.10.1.tgz.sha256) |
| 大小／文件数 | 909,654 字节／291 个文件 |
| 验证环境 | 官方 DSH `0.2.1-alpha.2`、Node `24.21.0`，独立临时 profile |
| 安装、卸载、许可 | [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

职业人归档不是永久删除。既有 `archiveTemplate` 仅将模板 `status` 设为 `archived`，更新版本和时间；模板记录、配置、团队引用和已有项目实例保留，可用列表隐藏该模板，当前没有一键恢复入口。本次不修改服务端归档行为。

“归档职业人”从侧栏移到员工标题行、“还原修改”左侧，换用归档盒图标；提示和确认明确数据保留，存在未保存内容时提示草稿不会保存。仅已保存且未归档的职业人显示，新建草稿、团队成员创建页和项目员工不显示。操作组支持窄屏换行。

取消确认不发送命令；确认使用当前模板 ID 和 `expectedVersion`。失败保留选择及草稿，成功后重选可用职业人，并只移除原员工的本地草稿 key，避免影响后续编辑器。

## 验证

- 构建和类型检查通过：[构建日志](../artifacts/employee-archive-validation/build.log)、[类型日志](../artifacts/employee-archive-validation/typecheck.log)。本次没有改变服务端归档逻辑，不重复运行无关的全量单元测试。
- 最终实包 **63 项 UI 检查全部通过**，保留原 59 项并新增 4 项归档回归：[结果](../artifacts/employee-archive-validation/employee-settings-result.json)、[归档绑定](../artifacts/employee-archive-validation/ui-archive-binding.json)、[日志](../artifacts/employee-archive-validation/ui-e2e.log)。桌面／窄屏标题按钮完整可用；新建和项目员工不显示归档；取消确认零请求、完整状态不变且草稿保留；确认使用准确 ID／版本，仅归档状态、版本和更新时间变化，原记录、模块、描述、创建时间、其他状态及完整已有项目实例保留。归档对象从可用库及引入选择器隐藏，再创建项目副本返回 400 且状态不变，归档流程零模型调用。
- 最终实包 **13 项官方生命周期检查通过**，安装、普通卸载、重装、完全清理及原生恢复通过；12 个知识文件卸载重装逐字节一致：[报告](../artifacts/lifecycle-0.10.1/report.json)、[日志](../artifacts/lifecycle-0.10.1/lifecycle.log)。临时宿主、Wiki 子进程和 profile 均已清理。
- 官方宿主 **28,401 个程序文件**前后完整联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`，未修改官方宿主文件。
- 归档 **291 个文件**与源码／构建逐字节一致，无宿主补丁、用户数据、凭据或测试夹具：[白名单核对](../artifacts/employee-archive-package-inventory.json)。
- 只读审查未发现阻断问题，确认目标、取消与失败、显示范围和草稿清理边界正确：[审查结果](../artifacts/employee-archive-validation/read-only-review.json)。
- 当前 3081 实际标题按钮顺序为“归档职业人、还原修改、保存配置”，侧栏归档按钮数量为零，红色及数据保留提示正确；没有实际点击归档或修改配置，完整员工状态与本次基线一致：[CUA 结果](../artifacts/employee-archive-validation/live-cua-result.json)、[状态完整性](../artifacts/employee-archive-validation/live-state-integrity.json)、[实际页面](../artifacts/employee-archive-validation/live-archive-header.png)。

归档测试仅使用隔离 profile 中创建的 QA 模板和临时原生项目；用户 3081 未执行归档。测试截图见 [桌面入口](../artifacts/employee-archive-validation/employee-archive-header-desktop.png)、[窄屏入口](../artifacts/employee-archive-validation/employee-archive-header-narrow.png)、[隐藏后列表](../artifacts/employee-archive-validation/employee-archive-hidden-library.png)、[保留项目实例](../artifacts/employee-archive-validation/employee-archive-preserved-project.png)。临时浏览器、宿主、Wiki 子进程及 profile 均已清理。

首轮新增测试错误地要求归档后所有编辑器消失；既有选择逻辑会自动选中首个可用职业人。仅修正测试为严格验证 QA 行消失、当前员工不是 QA 或其草稿、首员工字段与持久记录一致且未修改，保留全部数据及版本断言；同一归档完整重跑 63 项通过。首轮证据保留，详见 [测试说明](../artifacts/employee-archive-validation/test-notes.md)。

所有正式报告绑定以上最终物理归档及哈希，验收后未重新打包。
