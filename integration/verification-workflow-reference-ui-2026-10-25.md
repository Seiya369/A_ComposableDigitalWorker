# 工作流引用与项目界面验收：0.26.0

日期：2026-10-25。状态：通过。

## 绑定交付物

- 归档：`artifacts/dsh-plugin-composable-workforce-0.26.0.tgz`
- SHA-256：`7179f37068e4b8db5002119a2ed1f47a89f12c31b81ec684fdcd89b111b20256`
- 大小：1,072,775 字节；363 个打包文件。
- 汇总及各报告哈希：[validation-summary.json](../artifacts/workflow-reference-ui-validation/validation-summary.json)。

## 验收行为

项目知识库移除了状态与版本行、返回全图按钮及多余外框。节点类别和知识分组位于知识图谱标题右侧；原有适应屏幕按钮承担返回完整视图的操作。图谱节点、语义关系、来源依据和阅读能力保留。

步骤内容、交付内容、验收标准均默认收起，支持独立展开，检查其他步骤时重新默认收起。只有源定义显式配置了退回步骤时才展示退回目标；业务层本步骤返工的缺省规则未改变。浏览详情不会激活步骤。

对话顶部右侧显示当前负责人的“正在对接”提示，使用步骤名称相同的 12px 字号并与其及原生轨迹文字底部对齐。删除旧员工名称与待验收状态行；历史交付仍可由精简的任务与交付入口访问。公开 UI 插槽只管理插件自身元素，不修改宿主组件、程序文件或祖先样式。

对话工作流菜单只读取 graph_horses 的工作流库，名称、顺序和版本一致。旧项目独有定义只登记一次到公共库；项目保留负责人绑定、权限、知识和执行进度。公共定义后续修改会原子同步；繁忙执行和破坏历史绑定的修改会明确拒绝。删除来源不会复活成孤立菜单项。名称修改保留完成标记，步骤契约修改使受影响的完成标记失效，原始交付记录保留。

## 测试证据及范围

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| 全量单元测试 | 695 通过、1 跳过、0 失败 | 696 项，包含引用同步、原子失败、迁移及历史保护 |
| 类型检查、构建 | 通过 | 冻结归档对应工作区 |
| 详情组件 | 16/16 | 源码组件与受控数据；6 个源文件哈希逐项匹配归档 |
| 官方原生对话 | 30/30 | 同一归档安装到隔离的官方 DSH，含原生路由、布局、当前负责人和旧会话 |
| 原生语言切换 | 3/3 | 跟随宿主语言，保存内容及未发送草稿保留，无业务写入 |
| Wiki 工具栏 | 8/8 | 同一归档内 HTML，受控父页面与数据；中英、明暗、1440/320 宽度 |
| 安装卸载生命周期 | 14/14 | 官方 CLI、临时独立 profile、普通卸载重装、完全清理、原生功能 |

官方版本为 DSH `0.2.1-alpha.2`，39 个运行时 peer 解析到官方安装。28,779 个宿主程序文件前后摘要一致：`91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`。最终原生测试和生命周期测试的临时根目录已移除，隔离端口已关闭。

完整生命周期报告：[report.json](../artifacts/lifecycle-0.26.0/report.json)。各自动化结果保存在 `artifacts/workflow-reference-ui-validation/` 的 `component/`、`native/`、`wiki-toolbar/` 中。Wiki 受控测试不冒充宿主执行；实际宿主显示另由下面的检查确认。

## 当前服务和真实项目

通过官方安装机制更新 3081 服务。363 个安装文件逐项匹配上述归档，39 个 peer 均来自官方安装。

授权迁移仅将状态修订从 130 更新为 131，登记原有演示工作流并添加引用标记。原有工作流定义、人员、项目组织、选择、步骤进度和交付记录保留；606 个知识文件哈希不变。迁移后再检查 3 个会话的状态、视图及配置，均与迁移后基线一致。本次页面核对没有上传、重组知识、运行工作流或调用模型。

- [迁移差异](../artifacts/workflow-reference-ui-validation/live/reference-migration.json)
- [实际安装核对](../artifacts/workflow-reference-ui-validation/live/installation.json)
- [数据保留核对](../artifacts/workflow-reference-ui-validation/live/data-preservation.json)
- [实际页面检查](../artifacts/workflow-reference-ui-validation/live/ui-checks.json)
- [负责人及对话菜单截图](../artifacts/workflow-reference-ui-validation/live/owner-and-picker.png)
- [同一公共工作流库截图](../artifacts/workflow-reference-ui-validation/live/library-workflows.png)
- [详情默认折叠截图](../artifacts/workflow-reference-ui-validation/live/detail-collapsed.png)
- [项目知识库截图](../artifacts/workflow-reference-ui-validation/live/wiki-clean-toolbar.png)

本轮没有创建工作树，也没有为此变更修改 Harness 源码、构建物或原生组件。
