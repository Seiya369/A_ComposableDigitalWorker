# 对象设置交换与统一操作栏验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.12.0` 最终物理归档。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.12.0.tgz](../artifacts/dsh-plugin-composable-workforce-0.12.0.tgz) |
| SHA-256 | `5e4b97e0def89f6036b021b865b7c061928ca69cb9e545a07d485747a66d80d8` |
| 校验文件 | [SHA-256](../artifacts/dsh-plugin-composable-workforce-0.12.0.tgz.sha256) |
| 大小／文件数 | 935,008 字节／299 个文件 |
| 验证环境 | 官方 DSH `0.2.1-alpha.2`、Node `24.21.0`，独立临时 profile |
| 安装、卸载、许可 | [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

## 最终行为

“职业人 Horse”及侧栏统一改为“自由职业人库”。自由职业人、团队、工作流的标题栏统一为移除、导入、导出、保存；新建对象的移除禁用。团队资料管理员继续放在操作组左侧。三个模板页面取消通用模板／项目实例范围切换、全局导入／导出 JSON 和刷新图标；取消员工和工作流的还原修改按钮及工作流底栏，保留离开时放弃草稿的确认。项目工作台通过原生会话团队配置进入，从项目标题栏可返回自由职业人库。

移除恢复宿主原主题红色，深色为 `rgb(242, 90, 90)`、本次浅色为 `rgb(236, 19, 19)`，实际比较宿主错误主题 token。自由职业人移除沿用 `template.archive` 隐藏语义，提示及确认明确保留配置记录和已有项目实例；团队和工作流移除沿用原模板删除行为，不修改已引入的实例或副本。

导入／导出沿用严格 `graph_horses` v1 模板 JSON，最大 1 MiB，只接受当前同类型独立对象。导出当前表单及必要依赖，含未保存改动；沿用原便携脱敏。导入自动覆盖当前表单草稿，不立即写入依赖或根对象。继续编辑、导出和保存都使用最新草稿；保存时经插件自有 `settings.bundle.save` 原子提交根对象与新依赖，保留目标 ID、创建时间和本地版本基线，其他已有配置及项目实例不覆盖。错误文件不修改表单，冲突不部分写入。详见[对象设置交换](../docs/architecture/object-settings-transfer.md)。

## 验证

- 构建、类型检查与 **24 项领域／既有交换／HTTP API 测试通过**：[构建](../artifacts/object-settings-validation/build.log)、[类型](../artifacts/object-settings-validation/typecheck.log)、[测试日志](../artifacts/object-settings-validation/transfer-tests.log)。覆盖严格格式、旧新兼容、依赖映射、身份与版本保护、原子回滚、重复保存以及本地声明保存与便携导出分离。
- 最终实包 **28 项对象交换浏览器专项通过**：[报告](../artifacts/object-settings-validation/object-transfer-ui/report.json)、[日志](../artifacts/object-settings-validation/object-transfer-ui/run.log)。包括三对象各五类坏文件、完整覆盖、未保存不落盘及放弃、旧新格式双向兼容、导入后编辑再导出与保存、二次保存、依赖冲突与陈旧版本整事务回滚、失败保留草稿、合法本地文件声明保存保留而导出排除、延迟读取禁用／换对象隔离、新建团队草稿重挂载根 ID 与完整依赖保留。专项模型调用为零，既有项目实例与执行等数据不变。
- 最终实包 **67 项维护 UI 回归通过**：[结果](../artifacts/object-settings-validation/maintained-ui/employee-settings-result.json)、[归档绑定](../artifacts/object-settings-validation/maintained-ui/ui-archive-binding.json)、[日志](../artifacts/object-settings-validation/maintained-ui/ui-e2e.log)。保留既有 AI 迟到取消与失败重试、草稿保留／放弃、能力、知识图谱和严格增量等场景。已取消的还原改为同员工重选、导航取消、确认放弃后重新进入严格回读；项目路径改为原生新会话 → 配置项目团队 → 在 graph_horses 中管理，并验证返回库。员工／团队／工作流的操作顺序、无全局范围和工具栏、两主题颜色及移除确认／实例保留均通过。
- 深浅主题与宽窄页面完整可用：[员工桌面](../artifacts/object-settings-validation/object-transfer-ui/employee-desktop-dark.png)、[团队桌面](../artifacts/object-settings-validation/object-transfer-ui/team-desktop-dark.png)、[工作流桌面](../artifacts/object-settings-validation/object-transfer-ui/workflow-desktop-dark.png)、[员工窄屏浅色](../artifacts/object-settings-validation/object-transfer-ui/employee-narrow-light.png)、[团队窄屏浅色](../artifacts/object-settings-validation/object-transfer-ui/team-narrow-light.png)、[工作流窄屏浅色](../artifacts/object-settings-validation/object-transfer-ui/workflow-narrow-light.png)。
- 最终实包 **13 项官方生命周期通过**，验证安装、普通卸载、重装、完全清理及原生恢复；12 个知识文件卸载重装逐字节一致：[报告](../artifacts/lifecycle-0.12.0/report.json)、[日志](../artifacts/lifecycle-0.12.0/lifecycle.log)。官方宿主 28,401 个程序文件前后完整联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`；临时目录及残留进程清理完成。生命周期不替代上述新增交互专项。
- 299 个打包文件与源码／构建逐字节一致，无宿主补丁、用户数据、凭据或测试夹具：[白名单核对](../artifacts/object-settings-package-inventory.json)。只读审查通过，确认原子事务、版本及依赖保护、草稿、迟到读取和下载资源清理边界：[审查报告](../artifacts/object-settings-validation/read-only-review.json)。审查期间修复的禁用后迟到读取、新建员工禁用移除均在最终包内，并经专项及维护 UI 回归验证。
- 当前 3081 已用原配置重启服务，新增 API 已加载；仅提交空配置验证其返回 `400 VALIDATION`，未保存测试对象：[接口烟测](../artifacts/object-settings-validation/live-api-smoke.json)。重启前后完整状态相同，13 条职业人记录、1 个团队、6 个项目员工和 2 个待验收任务保留：[状态完整性](../artifacts/object-settings-validation/live-state-integrity.json)。三页四按钮顺序、原红色、无范围／全局工具栏／还原均核对：[CUA 结果](../artifacts/object-settings-validation/live/cua-result.json)、[实际员工页](../artifacts/object-settings-validation/live/employee.jpg)、[实际团队页](../artifacts/object-settings-validation/live/team.jpg)、[实际工作流新建页](../artifacts/object-settings-validation/live/workflow-new.jpg)。

## 测试适配记录

专项前两轮仅修正测试：等待官方工作区事件完成插件项目同步；新建且未保存的根对象跨重挂载仅规范化合成时间字段，根 ID、版本、全部配置及完整依赖仍严格比较，已保存目标创建时间检查未放宽。[原始证据及理由](../artifacts/object-settings-validation/object-transfer-ui/iterations.md)完整保留。

维护回归首轮仍使用上一版本 `#DC2626` 预期，与本轮用户明确恢复之前主题红色的新要求冲突；记录首轮后，改为严格匹配同主题宿主 token，并核对深色精确 RGB，使用同一物理归档完整重跑通过。[首轮证据](../artifacts/object-settings-validation/maintained-ui/first-red-color-regression)及最终测试说明保留。没有为测试适配修改产品或归档。

正式结果均绑定以上最终归档和 SHA-256，验收后未重新打包。所有写入与移除测试在隔离 profile 中执行，用户 3081 未导入、覆盖、保存或移除已有对象。
