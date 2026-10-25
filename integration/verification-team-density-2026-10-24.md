# 团队页紧凑布局验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.11.0` 最终物理归档。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.11.0.tgz](../artifacts/dsh-plugin-composable-workforce-0.11.0.tgz) |
| SHA-256 | `a88cd062dd795c7dda38c2a55d4e9395fe4a41e4c5ca8583df6af40a0904e0e9` |
| 校验文件 | [SHA-256](../artifacts/dsh-plugin-composable-workforce-0.11.0.tgz.sha256) |
| 大小／文件数 | 910,724 字节／291 个文件 |
| 验证环境 | 官方 DSH `0.2.1-alpha.2`、Node `24.21.0`，独立临时 profile |
| 安装、卸载、许可 | [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

## 最终行为

团队标题栏右侧依次为资料管理员、移除团队、保存团队。取消底部操作栏、团队页的还原修改、添加员工按钮及“引入职业人 Horse”标签；选择框显示“选择要引进人员”。标题、引入行与岗位控件压缩高度，岗位按两张成组卡片一行排列，每张包含“团队岗位”“上一级”和移除按钮。主区宽度不超过 700px 时单列，不超过 400px 时卡内字段上下排列、标题操作可换行；工作流编辑器保持原布局。

还原修改表示丢弃未保存草稿并恢复已保存配置。团队页取消该按钮后，保留导航离开时的确认：取消继续编辑，确认放弃后再次进入读取已保存值。单纯临时收起插件页面仍可能保留模块内草稿，不承诺所有形式的“退出”都自动清空。标题下保留“组织结构 · 未保存”状态。

移除团队及岗位均先弹出确认框。取消不修改草稿或发送命令；岗位确认后仅改草稿，保存团队后才持久化。工作流使用中的岗位继续禁止移除，上一级候选继续排除自身和后代，保存保留版本校验。移除团队保留已有项目实例；成功只清理该团队自己的本地草稿，失败保留当前编辑内容。移除、删除及职业人归档等操作控件统一使用 `#DC2626`，不将只读导航状态误当成操作。

## 验证

- 构建、类型检查及团队／组织层级 **30 项测试通过**：[构建日志](../artifacts/team-density-validation/build.log)、[类型日志](../artifacts/team-density-validation/typecheck.log)、[团队测试](../artifacts/team-density-validation/team-tests.log)。未改变服务端存储及执行逻辑，不重复运行无关全量测试。
- 最终实包 **67 项 UI 检查首轮全部通过**：[结果](../artifacts/team-density-validation/employee-settings-result.json)、[归档绑定](../artifacts/team-density-validation/ui-archive-binding.json)、[日志](../artifacts/team-density-validation/ui-e2e.log)。保留原 63 项的有效场景；已取消的团队添加入口改为职业人库新建、团队引入、验证草稿、保存及移除清理，原团队还原测试改为导航取消与确认放弃后重新进入回读。
- 新增布局、岗位移除取消／确认／保存、独立 QA 团队移除及深浅主题颜色回归。团队移除确认后完整状态仅减少该 QA 团队，职业人、工作流和已有项目实例精确保留；取消零请求且完整状态不变。岗位移除确认后保存前持久状态不变。覆盖两主题下团队、岗位、Skill／插件／MCP、专业资料及职业人归档颜色；均为 `rgb(220, 38, 38)`。
- 宽屏、浅色和短窗均为等宽双列；窄主区单列。标题约 65px，标题动作 28px，岗位卡约 69px：[深色双列](../artifacts/team-density-validation/team-page-dark.png)、[浅色双列](../artifacts/team-density-validation/team-page-light.png)、[窄屏](../artifacts/team-density-validation/team-page-narrow.png)、[短窗](../artifacts/team-density-validation/team-page-short.png)。
- 最终实包 **13 项官方生命周期检查通过**，安装、普通卸载、重装、完整清理及原生恢复通过；12 个知识文件卸载重装逐字节一致：[报告](../artifacts/lifecycle-0.11.0/report.json)、[日志](../artifacts/lifecycle-0.11.0/lifecycle.log)。官方宿主 28,401 个程序文件前后完整联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`，临时目录与残留进程均已清理。
- 归档 291 个文件与源码／构建逐字节一致，无宿主补丁、用户数据、凭据或测试夹具：[白名单核对](../artifacts/team-density-package-inventory.json)。只读审查通过，12 处删除／移除／归档控件无漏色，草稿、确认、版本及组织层级保护正确：[审查结果](../artifacts/team-density-validation/read-only-review.json)。
- 当前 3081 实际页面标题区从约 86.5px 减至 64.5px、引入行从约 61.5px 减至 30px，旧 64.5px 底栏取消；712px 窗口主区单列，卡片由约 86px 减至 68px，7 个团队移除控件颜色正确：[CUA 尺寸](../artifacts/team-density-validation/live-cua-result.json)、[实际页面](../artifacts/team-density-validation/live-team-compact.png)。没有实际移除、保存或修改用户配置，完整状态与本轮基线一致：[状态完整性](../artifacts/team-density-validation/live-state-integrity.json)。

UI 测试仅在隔离 profile 中创建及移除 QA 数据，无付费模型调用；用户 3081 的 13 条职业人记录、1 个团队、6 个项目员工和 2 个运行记录全部保留。正式报告绑定以上归档和哈希，验收后未重新打包。
