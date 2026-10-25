# 工作流团队与流程图验收

归档：`dsh-plugin-composable-workforce-0.14.0.tgz`

SHA-256：`de0e00a1371b4f10aee07cd23ac9a6715f82139c945f347627bd2ea6c06ced00`

主交付为 [npm 插件包](../artifacts/dsh-plugin-composable-workforce-0.14.0.tgz) 与 [校验和](../artifacts/dsh-plugin-composable-workforce-0.14.0.tgz.sha256)。安装、卸载、完全清理及兼容范围见 [安装说明](README.md) 和归档内 README；当前仍适用已验证的官方 DSH 0.2.1-alpha.2。许可见归档 LICENSES.md。更新内容见 [CHANGELOG](../CHANGELOG.md) 与 [工作流说明](../docs/architecture/workflow-editor.md)。

## 实现结果

- 删除保存成功横幅，团队入口移至工作流标题右侧。
- 未引入团队时不能选择步骤负责人；引入后只显示该团队成员，保留职业人引用与上下级关系。
- 团队快照及负责人身份随工作流保存和传输；更换团队有丢失负责人确认，未重新分配前不能保存。
- 底部顺序图随步骤和负责人同步，节点可定位编辑位置；窄容器折行且保持箭头顺序。
- 现有“软件工程”已升级，原 12 个步骤、角色 ID、名称及内容保持；六位员工及其模型、知识、项目实例、记忆和待验收任务均未变。

## 最终验证

[归档清单](../artifacts/workflow-team-validation/package-inventory.json)：309 文件逐字节与审查源文件一致，无宿主补丁、本机用户数据或测试夹具。

[重点测试](../artifacts/workflow-team-validation/targeted-tests.log) 37 项通过；[类型检查](../artifacts/workflow-team-validation/typecheck.log) 与 [构建](../artifacts/workflow-team-validation/build.log) 通过。开发阶段 [完整测试](../artifacts/workflow-team-validation/development-full-tests.log) 491 项通过；后续兼容修正由上述重点测试补验。

[最终实包界面验证](../artifacts/workflow-team-validation/ui/report.json)：12 项通过，涵盖团队限定、取消与焦点、输入保留、旧绑定恢复、导入导出、更换负责人、流程图排序定位、320px/712px/1512px 与明暗主题；无模型调用。

[独立官方 profile 生命周期](../artifacts/lifecycle-0.14.0/report.json)：13 项通过，实包安装、核心功能、普通卸载、重装、完整清理与原生宿主验证均成功。宿主 28401 文件前后 SHA-256 一致：`401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。

[当前数据完整性](../artifacts/workflow-team-validation/live-state-integrity.json) 和 [CUA 实际页面核对](../artifacts/workflow-team-validation/live-cua-verification.json) 已保存；当前工作流 12 节点、11 顺序边，12 个负责人选择框各含六个真实成员及一项占位选项。

[测试修复及首次失败记录](../artifacts/workflow-team-validation/test-notes.md) 保留。

![标题与成员限定](../artifacts/workflow-team-validation/live-header.jpg)

![底部流程图](../artifacts/workflow-team-validation/live-diagram.jpg)
