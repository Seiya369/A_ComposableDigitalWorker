# 工作流三栏与条件退回验收

归档：dsh-plugin-composable-workforce-0.15.0.tgz

SHA-256：`1b072b6c86b6cb507b4bb9393755ea2f634d4c73eaf64838f1dc63edefb57c01`

主交付为 [npm 插件包](../artifacts/dsh-plugin-composable-workforce-0.15.0.tgz) 与 [校验和](../artifacts/dsh-plugin-composable-workforce-0.15.0.tgz.sha256)。安装、普通卸载、完全清理及兼容说明见 [安装说明](README.md) 与包内 README；官方 DSH 兼容版本仍为 0.2.1-alpha.2，未扩大兼容范围。许可与第三方声明见包内 LICENSES.md、integration/THIRD_PARTY_NOTICES.md。

## 完成内容

- 步骤说明、交付内容、验收标准等宽三栏，窄屏上下排列；逐行输入不吞 Enter，未编辑旧数组及隐藏字段保持。
- 不合格可选本步骤或之前步骤，稳定身份随绑定和导入导出重映射；非法排序阻止，移除目标需确认并清理引用。流程图红色虚线标记退回。
- 人工验收不合格先等待处理，确认返工后才重启目标至判断步骤；整个区间重新执行及验收。旧交付、任务和验收保留历史，失效尝试不再成为当前有效交接或已验证知识，关闭自动归档也不能保留失效的有效证据。默认每步累计 3 次，不因返工清零。运行报错重试当前步骤，暂停、取消、重启、版本及幂等语义保持。
- 实际“软件工程”版本 3 → 4、状态修订 80 → 81：12 步补齐交付内容，迁移重复交付说明至对应栏；第 10 步回归不合格退回第 9 步缺陷修复。其他步骤默认本步返工。六位员工、源团队、已有项目及待验收任务未改；既有工作流副本保持冻结。未启动真实工作流或请求模型。

## 复测与证据

- [完整测试](../artifacts/workflow-rework-validation/all-tests.log)：499 项全部通过；类型检查与 [构建](../artifacts/workflow-rework-validation/build.log) 成功。新增 7 项返工测试覆盖多步失效、重新验收、模型运行报错、暂停及次数边界、稳定身份传输、无效引用原子拒绝、停用自动归档后的有效知识撤销。
- [最终实包 UI 测试](../artifacts/workflow-rework-validation/ui/report.json)：14 项通过，覆盖等宽三栏与 Enter、团队限定、旧字段、配置传输、引用移除及非法排序、流程图、320/712/1512 宽度和明暗主题，无模型请求。
- [最终生命周期](../artifacts/lifecycle-0.15.0/report.json)：13 项通过，独立干净官方 profile 安装、核心功能、普通卸载、重装、完全清理和原生功能正常；宿主 28401 个程序文件前后哈希一致，`401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。
- [包清单](../artifacts/workflow-rework-validation/package-inventory.json)：311 个文件逐字节匹配审查源和构建物，无宿主补丁、用户数据、凭据或测试夹具。
- [实际数据完整性](../artifacts/workflow-rework-validation/live-state-integrity.json)、[实际界面核对](../artifacts/workflow-rework-validation/live-cua-verification.json)、[绑定归档哈希的验收结果](../artifacts/workflow-rework-validation/acceptance.json)。

README 的旧介绍在首次打包后更正，最终实包 UI 与生命周期均重新验证，以上记录绑定最终哈希；执行代码及 499 项完整测试未再修改。首次校验记录保留在 initial-package-checks。

![等宽三栏宽屏验证](../artifacts/workflow-rework-validation/ui/workflow-wide-dark.png)

![实际回归退回规则](../artifacts/workflow-rework-validation/live-return.jpg)

![实际流程图](../artifacts/workflow-rework-validation/live-diagram.jpg)
