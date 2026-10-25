# 工作流基本编辑验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.13.0` 最终物理归档。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.13.0.tgz](../artifacts/dsh-plugin-composable-workforce-0.13.0.tgz) |
| SHA-256 | `2651bb91d9d4eba81c07c7fca71689da248a58d269a6bb9a1f61b12027bea115` |
| 校验文件 | [SHA-256](../artifacts/dsh-plugin-composable-workforce-0.13.0.tgz.sha256) |
| 大小／文件数 | 940,893 字节／303 个文件 |
| 环境 | 官方 DSH `0.2.1-alpha.2`、Node `24.21.0`，独立临时 profile |
| 安装、卸载与许可 | [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

## 最终行为

工作流侧栏复用自由职业人库的单行图标与名称样式，移除岗位数、步骤数及版本副行。标题栏沿用移除、导入、导出、保存及 32px 控件，不增加维度页签。主区仅显示有序步骤卡，每步编辑步骤名称、负责人、步骤说明和验收标准；支持添加、上移、下移和确认移除，至少一个、最多 50 个步骤。

验收标准可真实逐行键入，编辑草稿保留 Enter 和末尾空行，保存／导出只清理已编辑项中的空行，未编辑的历史数组及单项内多行原文保持不变。步骤排序移动完整对象；工作流说明、角色说明、输入输出、超时及尝试上限继续保存，不因界面隐藏而写入默认值或清空。包括 `constructor` 等历史步骤 ID 在内的验收覆盖层按自有键读取，避免误用对象原型属性。

负责人可选择已有流程角色、自由职业人名称或自定义名称；同名不同角色按 ID 独立区分。选择职业人仅建立同名流程职责，使用时再映射实际成员，不改变模板格式或直接启动员工。“引入团队”移到侧栏模态框，支持 Escape、关闭、取消、焦点返回及窄屏滚动。团队绑定及项目引入仅要求映射步骤实际引用的角色，旧未用角色及说明仍保留。详见[工作流编辑](../docs/architecture/workflow-editor.md)。

## 验证

- 构建、类型检查及 **23 项相关领域测试通过**：[构建](../artifacts/workflow-basic-validation/build.log)、[类型](../artifacts/workflow-basic-validation/typecheck.log)、[测试日志](../artifacts/workflow-basic-validation/domain-tests.log)。验证在用角色顺序、同名不同 ID、缺失在用映射与未知键拒绝、未用映射可省略，以及角色描述与步骤隐藏字段保留。
- 最终实包 **16 项工作流浏览器专项通过**：[报告](../artifacts/workflow-basic-validation/workflow-ui/report.json)、[绑定](../artifacts/workflow-basic-validation/workflow-ui/ui-archive-binding.json)、[日志](../artifacts/workflow-basic-validation/workflow-ui/ui-e2e.log)。涵盖三步骤创建、真实 Enter 多条验收、自定义取消及创建、库选择、同名角色独立、排序、移除取消／接受、连续两次保存与重新进入、完整历史字段及省略字段、保存失败保留草稿并重试、团队弹框、旧接口及新旧项目独立副本。模型调用为零。
- 最终实包 **28 项对象设置交换回归通过**：[报告](../artifacts/workflow-basic-validation/object-transfer-ui/report.json)、[日志](../artifacts/workflow-basic-validation/object-transfer-ui/ui-e2e.log)。三个对象的错误文件保护、完整覆盖、未保存不落盘、旧新格式、原子保存、重复保存、冲突回滚、迟到读取隔离与草稿恢复均通过，模型调用为零。工作流隐藏字段以导出正文及保存记录精确核对，未因简化字段降低断言。
- 深浅主题、宽屏、窄屏及矮窗通过：[桌面深色](../artifacts/workflow-basic-validation/workflow-ui/workflow-desktop-dark.png)、[桌面浅色](../artifacts/workflow-basic-validation/workflow-ui/workflow-desktop-light.png)、[窄屏](../artifacts/workflow-basic-validation/workflow-ui/workflow-narrow-dark.png)、[短窗](../artifacts/workflow-basic-validation/workflow-ui/workflow-short-dark.png)、[三步骤编辑](../artifacts/workflow-basic-validation/workflow-ui/workflow-three-step-draft.png)、[在用角色团队映射](../artifacts/workflow-basic-validation/workflow-ui/workflow-team-used-role-mapping.png)。侧栏行高与员工列表同为 32px，四个标题操作可见且可用。另有隔离组件 8 项安装表单检查通过：[记录](../artifacts/workflow-basic-validation/installer-used-roles.json)。
- 最终实包 **13 项官方生命周期通过**，安装、普通卸载、重装、完整清理及原生恢复通过；12 个知识文件卸载重装逐字节一致：[报告](../artifacts/lifecycle-0.13.0/report.json)、[日志](../artifacts/lifecycle-0.13.0/lifecycle.log)。宿主 28,401 个程序文件前后完整联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`，临时目录及残留进程清理完成。
- 303 个归档文件与源码／构建逐字节一致，不含宿主补丁、用户数据、凭据或测试夹具：[白名单核对](../artifacts/workflow-basic-package-inventory.json)。只读审查通过，隐值保留、验收覆盖层、角色身份、草稿与连续保存、模态框及版本边界正确：[审查](../artifacts/workflow-basic-validation/read-only-review.json)。
- 当前 3081 已重启加载在用角色绑定逻辑，完整状态与本轮基线一致，13 条职业人记录、1 个团队、6 个项目员工和 2 个待验收任务保留，工作流记录仍为 0，未写入 QA 示例：[状态完整性](../artifacts/workflow-basic-validation/live-state-integrity.json)。实际新建页仅有四个步骤字段、四个标题操作、无维度页签／主区团队映射／底栏，六个库内名称可选：[CUA 核对](../artifacts/workflow-basic-validation/live-cua-result.json)、[实际页面](../artifacts/workflow-basic-validation/live-workflow-basic.jpg)。

专项前两轮仅修正测试助手：Playwright `APIResponse` 的错误诊断使用 `text()`；同名角色按产品已有“角色 1／角色 2”标签和独立 value 严格验证，不再错误期待两个完全相同标签。原始证据完整保留于 [首轮](../artifacts/workflow-basic-validation/workflow-ui/first-playwright-response-helper-failure)及[第二轮](../artifacts/workflow-basic-validation/workflow-ui/second-duplicate-owner-label-assumption)。产品及物理归档未因测试适配修改，同一 SHA 完整重跑通过。

本轮没有重复运行不受影响的员工 67 项大套。正式结果绑定以上归档及 SHA-256，验收后未重新打包；所有写入、移除、绑定及项目副本测试均在隔离 profile 中执行，用户 3081 未保存、导入或移除任何已有对象。
