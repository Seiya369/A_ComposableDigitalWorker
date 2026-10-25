# 员工默认模型配置页验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.9.1` 的最终物理归档。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.9.1.tgz](../artifacts/dsh-plugin-composable-workforce-0.9.1.tgz) |
| SHA-256 | `d06e8a06a4b7cbd574208cac6d1a3fc026218756d1395d160d83d8288c7a74cb` |
| 校验文件 | [SHA-256](../artifacts/dsh-plugin-composable-workforce-0.9.1.tgz.sha256) |
| 大小／文件数 | 908,423 字节／291 个文件 |
| 官方兼容验证 | DSH `0.2.1-alpha.2`、Node `24.21.0`，独立临时 profile |
| 安装、卸载与许可 | [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

`EmployeeEditor` 初始页签由岗位定义改为模型配置。员工模板、团队成员及项目员工共用此编辑器，切换员工通过既有身份 key 重新挂载，因此初次进入及切换到另一员工时均从模型配置开始。不改模型选项、保存行为或 AI 智填流程；岗位定义仍可通过相邻页签进入。当前规范与更新记录同步修改。

## 验证

- `npm run build`、`npm run typecheck` 通过：[构建日志](../artifacts/employee-default-model-validation/build.log)、[类型日志](../artifacts/employee-default-model-validation/typecheck.log)。本次为单行 UI 默认值变更，未重复运行上一版的 477 项全量单元测试。
- 最终实包 **52 项 UI 检查通过**：初次点击员工断言选中模型配置并实际呈现模型面板；从岗位定义切换另一员工、再切回原员工均重新断言默认模型页。随后显式进入岗位定义，完整保留原布局、AI 填写与取消隔离、灰色文字、图谱与归档检查：[结果](../artifacts/employee-default-model-validation/employee-settings-result.json)、[归档绑定](../artifacts/employee-default-model-validation/ui-archive-binding.json)、[日志](../artifacts/employee-default-model-validation/ui-e2e.log)。使用隔离离线模型，不调用真实付费模型。
- 最终实包 **13 项官方生命周期检查通过**：安装、使用、普通卸载、重装、完整清理及宿主恢复通过；12 个知识文件卸载重装前后逐字节一致：[报告](../artifacts/lifecycle-0.9.1/report.json)、[日志](../artifacts/lifecycle-0.9.1/lifecycle.log)。临时宿主、共享 Wiki 子进程和临时 profile 均已清理。
- 官方宿主 **28,401 个程序文件**前后完整联合 SHA-256 一致：`401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。没有修改宿主源码、构建、内置插件或 node_modules。
- 归档 **291 个文件**与当前源码／构建逐字节一致，无宿主补丁、用户数据、凭据或测试夹具：[白名单核对](../artifacts/employee-default-model-package-inventory.json)。
- 当前 3081 实际页面已验证初次打开、由岗位页切到其他员工、再返回原员工均默认选中模型配置。未编辑或保存配置、未调用模型，完整员工状态与前次基线一致：[CUA 结果](../artifacts/employee-default-model-validation/live-cua-result.json)、[状态完整性](../artifacts/employee-default-model-validation/live-state-integrity.json)、[实际截图](../artifacts/employee-default-model-validation/live-default-model.png)。

本记录及正式报告绑定以上最终归档与哈希，验收后未重新打包。历史 0.9.0 验收记录保留，不作为本次默认页行为的定义。
