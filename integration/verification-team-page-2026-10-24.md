# 团队页精简验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.10.0` 最终物理归档。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.10.0.tgz](../artifacts/dsh-plugin-composable-workforce-0.10.0.tgz) |
| SHA-256 | `31bb56b212c82e6ca60c310837bbe45f6fd60af8666cc1a4d322f53be48ffebf` |
| 校验文件 | [SHA-256](../artifacts/dsh-plugin-composable-workforce-0.10.0.tgz.sha256) |
| 大小／文件数 | 908,794 字节／291 个文件 |
| 验证环境 | 官方 DSH `0.2.1-alpha.2`、Node `24.21.0`，独立临时 profile |
| 安装、卸载、许可 | [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

## 用户可见行为

- 团队页左侧成员树仅展示层级和姓名，无点击配置、拖动、手型、成员按钮角色或键盘停靠点；团队标题仍可选择及折叠。组织图节点同样只读，滚动容器保留键盘访问。
- 删除团队页顶部“通用模板／项目实例”切换及刷新；保留导入导出。员工和项目页面保留原范围入口。删除团队内部“组织架构／工作流”页签与设置齿轮。
- 标题下“若干位员工”改为“组织结构”；团队名称可直接在标题编辑。旧简介和工作流数据仍参与完整保存，不因显示精简而删除。
- 资料管理员说明卡、启用状态文字和用途说明删除，改为标题栏右侧的紧凑开关。开关为 `role=switch`，12px 主题灰字，轨道 18.2×11.2px，与员工页开关视觉一致；修改草稿后通过“保存团队”生效，可用“还原修改”恢复。项目页继续使用原有资料管理员卡片。
- 主区成员命名、汇报关系、引入／移除、保存和还原保留；新建员工保存后返回所属团队。删除团队能力以底部小图标保留原确认及数据边界。旧团队成员导航缓存防御性恢复到所属团队，员工页导航不变。

## 验证结果

| 检查 | 结果与证据 |
| --- | --- |
| 构建与类型 | `npm run build`、`npm run typecheck` 通过；[构建日志](../artifacts/team-page-validation/build.log)、[类型日志](../artifacts/team-page-validation/typecheck.log) |
| 相关团队单元 | **30／30**，团队层级及项目团队逻辑；[日志](../artifacts/team-page-validation/team-unit.log)。本次未重复运行无关的全量单元测试 |
| 最终实包 UI | **59／59**，原 52 项完整保留，新增 7 项团队回归；[结果](../artifacts/team-page-validation/employee-settings-result.json)、[归档绑定](../artifacts/team-page-validation/ui-archive-binding.json)、[日志](../artifacts/team-page-validation/ui-e2e.log) |
| 团队保存与隔离 | 只读成员与组织图不跳转，标题可折叠，名称／管理员开关草稿保存还原、成员命名增删与汇报、简介及工作流保留、新建员工保存返回团队、仅团队隐藏范围与刷新均通过 |
| 布局与控件 | 深色、浅色、窄屏、短窗口通过；实际 SVG 宽高为 14px，管理员开关为 12px 灰字及约 18.2×11.2px 轨道；[深色](../artifacts/team-page-validation/team-page-dark.png)、[浅色](../artifacts/team-page-validation/team-page-light.png)、[窄屏](../artifacts/team-page-validation/team-page-narrow.png)、[短窗](../artifacts/team-page-validation/team-page-short.png) |
| 官方安装生命周期 | 最终归档 **13／13**，安装、普通卸载、重装、完整清理、原生恢复通过；12 个知识文件卸载重装逐字节一致；[报告](../artifacts/lifecycle-0.10.0/report.json)、[日志](../artifacts/lifecycle-0.10.0/lifecycle.log) |
| 宿主未变 | 前后 **28,401** 个程序文件的完整联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003` |
| 归档白名单 | **291 个文件**与源码／构建逐字节一致，无宿主补丁、用户数据、凭据或测试夹具；[核对结果](../artifacts/team-page-package-inventory.json) |
| 只读审查 | 未发现阻断问题；保存保留原字段，页面范围与导航边界正确；[审查结果](../artifacts/team-page-validation/read-only-review.json) |

UI 及生命周期测试均在隔离官方 profile 中执行。临时浏览器、宿主、共享 Wiki 子进程和目录已清理，无新增后台资源或持久化目录，不修改宿主源码、构建、内置插件或 node_modules。

## 实际 3081 与验证边界

实际软件开发团六位成员均为静态行，没有按钮角色、tabindex 或拖拽标记；长姓名下图标也保持约 14px。顶部范围／刷新、团队页签及大资料卡均为零，副标题为“组织结构”，右上开关实际为 12px、`rgb(173, 176, 182)`。点击成员不跳转；切换管理员只产生未保存草稿，已通过还原恢复开启，保存按钮重新禁用。当前完整员工状态与本次升级前基线一致，未实际保存配置或调用模型：[CUA 结果](../artifacts/team-page-validation/live-cua-result.json)、[状态完整性](../artifacts/team-page-validation/live-state-integrity.json)、[实际页面](../artifacts/team-page-validation/live-team-page.png)。

首候选 `bc88d797…3803da` 通过原检查后，实际窄屏检查发现静态 div 的长姓名会将 SVG 图标压小。最终包增加局部 `flex-shrink:0`，测试同时检查真实渲染宽高，重新构建、打包并完整执行 59 项 UI 与 13 项生命周期，正式报告均绑定本记录 `31bb56b2…8ffebf`；首候选包、报告及测量证据保留在验证目录。过程见 [测试说明](../artifacts/team-page-validation/test-notes.md)。

旧 `tests/ui/workforce.e2e.mjs` 仍描述历史六页签弹窗，本次不执行也不改写；维护中的现行实包套件覆盖本次行为。导航草稿使用模块私有 Map，旧成员导航兼容分支以代码审查确认，未使用无效的 sessionStorage 注入或新增测试钩子。团队截图可能包含测试保存后短暂的成功提示；实际页面截图无测试草稿。

所有正式报告绑定以上最终物理归档及哈希，验收后未重新打包。
