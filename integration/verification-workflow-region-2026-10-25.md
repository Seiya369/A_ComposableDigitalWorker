# 0.21.0 项目对话工作流区域验收记录

日期：2026-10-25。

本记录绑定下列最终 npm 插件归档。最终归档上的原生工作流、员工与语言回归、安装卸载生命周期均已通过。截图要求中的**精确左边界对齐、工作流区域顶部与原生标题顶部严格对齐、跨行占满红框**尚未满足；当前结果采用官方 `conversation.session.header.utilities` 自身可用空间，不应描述为全部红框要求已完成。

## 归档与官方环境

| 项目 | 已核实内容 |
| --- | --- |
| 插件包 | [`dsh-plugin-composable-workforce-0.21.0.tgz`](../artifacts/dsh-plugin-composable-workforce-0.21.0.tgz) |
| SHA-256 | `0a1e4facbc795def82b65830908ccb7b0762bca38e1a39877d669956d0736efa` |
| 归档大小 | 1,036,313 bytes |
| 归档检查 | 356 个文件均已比较；禁止文件清单为空 |
| 官方宿主 | 未修改的 npm 发行版 DSH `0.2.1-alpha.2` |
| 运行依赖 | 39 个声明的运行时 peer；Cordis `4.0.5`、plugin-loader `1.0.6`，其余记录在生命周期报告中 |
| 员工浏览器 | bundled Chromium `145.0.7632.6` |
| 验证隔离 | 独立临时 profile；运行依赖解析至同一份官方安装，未将开发目录整体链接成插件运行环境 |

归档元数据见 [archive.json](../artifacts/workflow-region-validation/final/archive.json)，完整运行依赖及宿主来源见 [生命周期报告](../artifacts/lifecycle-0.21.0/report.json)。[verification.json](../artifacts/workflow-region-validation/final/verification.json) 汇总最终结果及各项证据 SHA-256，状态为 `verified-with-explicit-layout-limits`。验收使用临时测试适配器提供受控模型响应；它不等同于在用户真实项目中发起模型任务。

## 验收范围及版本对应关系

| 验证 | 结果 | 证据与适用范围 |
| --- | --- | --- |
| 全量源码测试 | 649/649 | [源码日志](../artifacts/workflow-region-validation/final/full-tests.log)。执行在最后一次按钮 `aria-disabled` / 焦点保留小调整之前，不能称为最终归档修改后的全量重跑。 |
| 布局、transport、语言定向测试 | 24/24 | [定向日志](../artifacts/workflow-region-validation/final/targeted.log)，包括 9 项纯布局测试、退回目标投影及语言键检查。 |
| 默认选择、覆盖与配置定向测试 | 22/22 | [配置日志](../artifacts/workflow-region-validation/final/config-tests.log)。 |
| 最终归档原生对话工作流 | 23/23 | [native/report.json](../artifacts/workflow-region-validation/final/native/report.json) 内 `pluginArchive.sha256` 与本记录一致；[执行日志](../artifacts/workflow-region-validation/final/native-tests.log)。 |
| 最终归档原生工作流语言 | 3/3 | [locale-workflow-report.json](../artifacts/workflow-region-validation/final/native/locale-workflow-report.json)，同时包含在原生报告指标中。语言切换期间业务写请求为零。 |
| 最终归档员工设置与知识回归 | 67/67 | [employee-settings-result.json](../artifacts/workflow-region-validation/final/employee/employee-settings-result.json)。 |
| 最终归档资源库语言与英文几何 | 7/7 | 同一员工报告的 `metrics.locale`；[employee-validation-summary.json](../artifacts/workflow-region-validation/final/employee-validation-summary.json) 核对报告哈希、归档哈希、浏览器和临时 profile 清理结果。 |
| 最终归档生命周期 | 14/14 | [report.json](../artifacts/lifecycle-0.21.0/report.json) 与 [日志](../artifacts/workflow-region-validation/final/lifecycle.log)，覆盖安装、使用、普通卸载、原生宿主、重装恢复及完全清理。 |
| 顶部布局矩阵 | 16/16 | [布局报告](../artifacts/workflow-region-validation/final/header-source/layout/header-layout-matrix-report.json)：中英两种语言、1920/1512/860/660px、单字及26字标题。属于隔离官方 profile 的源码构建检查。 |
| 三层退回轨道最大高度 | 通过 | [max61/report.json](../artifacts/workflow-region-validation/final/header-source/max61/report.json)：顶部区域 61px、节点 14px、标签在节点下方、原生 tabs 在区域下方，宿主未变。 |
| 最终焦点行为 | 5 项通过 | [focus/report.json](../artifacts/workflow-region-validation/final/header-source/focus/report.json)：pending 与结算后焦点保留、连续 Enter 只有一次请求、真实退回线与 SVG 点击穿透、无模型调用及完成状态变化。属于源码构建检查。 |

[source-archive-correspondence.json](../artifacts/workflow-region-validation/final/header-source/source-archive-correspondence.json) 将布局矩阵使用的 `src/client/index.tsx` 注册及 `src/ui/conversation-workflow.css` 原字节与最终归档逐项核对，记录 16 例布局、焦点检查及 61px 最大高度。此对应关系不把源码检查改称为归档执行检查；最终归档另外执行了上表原生23项、员工67+7项和生命周期14项。

最终独立构建日志见 [build-final.log](../artifacts/workflow-region-validation/final/build-final.log)。上述日志由 `.local/workflow-region*` 原始日志复制归集，最终机器汇总同时记录其哈希。

## 本次确认的行为

- 未配置工作流时明确显示“工作流：无”；上拉列表第一项为“无”。首次选“无”不安装团队、不调用模型、不建立项目默认。
- 对尚未建立工作流默认的项目，首次非空选择安装冻结的工作流、团队、人员与组织关系副本，并清除本项目此前的“无”覆盖，使项目对话统一继承。该选择不自动发起执行。
- 已有项目默认后，某个对话选择其他工作流或“无”只覆盖该对话；刷新后保留。同项目、同工作流共享步骤进度。升级保留已有默认、人工覆盖、冻结来源版本和验收历史，不静默统一既有项目。
- 灰色表示未完成、白色表示人工验收通过、蓝色表示当前步骤。点击节点切换当前负责人及下属名单，不伪造之前步骤完成；仅负责人真实交付的有效人工验收推进进度。
- 顺序实线仅连接冻结定义中相邻且同时可见的步骤。上方虚线箭头只使用显式、有效的退回目标，支持自回环，最多三层并复用不重叠区间。隐藏端点不接到省略按钮，不虚构跨窗口边；拥挤未绘的退回目标仍保留在节点无障碍文本及详情中。
- 所有 SVG、坐标、样式和裁剪均限于插件子树；线层 `pointer-events: none`。退回路径端点位于14px圆点圆周，箭头不阻挡按钮。pending、执行中或不可用时禁止切换；焦点保留及重复按键已另行检查。
- 默认对话输入仍在同一个原生会话中交给当前负责人；模型、岗位要求、必备 Skill 和步骤验收要求随负责人路由。选择“无”移除工作流上下文与业务工具，模型继续遵守 DSH 原生最近使用及明确选择规则。
- 停止状态的旧独立员工根对话可以继承项目工作流；旧静止底栏不再占位，原记录与待验收内容保留。安全恢复不自动调用模型；未发送草稿保留，有未发送附件时先阻止不安全刷新并提供显式重试。
- 中文/English 跟随 DSH；工作流名、步骤名、职责、知识概念、文章、模型交付原文不改写。英文知识卡在1512/860px均保持36px卡高，标题省略且完整标题可访问、按钮不缩小、不与标题重叠；窄屏允许四卡整行横向滚动。

原生步骤与退回线截图见 [native-selected-dark.png](../artifacts/workflow-region-validation/final/native/native-selected-dark.png)，三层轨道截图见 [maximum-three-lane-61px.png](../artifacts/workflow-region-validation/final/header-source/max61/maximum-three-lane-61px.png)，英文知识卡的原始几何数据见 [knowledge-card-geometry.json](../artifacts/workflow-region-validation/final/employee/locale-library/knowledge-card-geometry.json)。

## 布局降级与未满足项

采用的是 DSH `0.2.1-alpha.2` 公开的右侧 `conversation.session.header.utilities`。工作流按该插槽实际可用宽度响应，右侧为原生打开方式/分栏控件保留36px：当前原生8px gap加插件自身28px间距。16例矩阵中该间距为36px，详情入口保留可见。

该插槽没有把工作流左边界绑定到独立 tabs 行“轨迹”之后的公开锚点。本版保留原生自然排布，工作流区域顶部未与原生标题顶部严格对齐，也未跨行占满红框。标题长度、语言及屏幕宽度会影响原生自然分配的可用宽度；长标题窄屏会减少可见节点，使用省略与详情补足。节点/退回轨道高度为38/47/54/61px，不采用负向溢出占据宿主其他行。

此次未修改宿主源码、构建物、内置插件或祖先 DOM/CSS，也未替换原生标题/对话/轨迹组件。要精确满足上述红框布局仍需官方提供相应整行插槽或布局锚点，不能用本次近似布局冒充达标。

## 宿主完整性、卸载与清理

生命周期报告记录官方安装及依赖共28,779个程序文件，安装前与安装、普通卸载、重装、完全清理后摘要一致：

```text
SHA-256: 91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967
files:   28779
```

普通卸载移除 bundle/API且重启不自动重装，保留插件数据供重装恢复；重装后人员、知识、冻结工作流、失败尝试、任务与验收记录保持。完全清理通过打包的命令及官方 CLI 移除插件专属状态/配置，用户交付和共享凭据保留，原生宿主可重启。

最终原生报告确认官方宿主未变且隔离进程停止。员工摘要确认临时 profile 已移除；员工报告确认三个知识空间复用一个引擎，宿主关闭后无残留引擎进程。上述清理结果对应隔离验收环境，不表示已卸载用户当前使用的插件或清理用户项目。

## 当前运行环境的安装与数据保留

当前环境另行完成最终归档安装与只读数据核对，不以隔离测试代替真实环境结果：

- [installation.json](../artifacts/workflow-region-validation/final/live/installation.json)：通过。实际安装版本为 `0.21.0`，归档哈希与本记录一致；安装目录的 `lib/index.js`、`lib/client.js`、`lib/llm-wiki/web.html` 原字节均与最终归档相同。39 个运行时 peer 均解析至官方安装的真实路径。
- [data-preservation.json](../artifacts/workflow-region-validation/final/live/data-preservation.json)：通过。状态文件字节哈希与 API 深比较均相同；461 个知识文件哈希、profile 配置及两个旧对话的工作流视图均保持。revision 为 `103`，两对话仍使用原工作流、当前步骤仍为 `experience-design`，没有自动改选步骤。
- 当前环境核对只进行鉴权及读取，记录的业务变更请求为零；未为了验收更改工作流选择、进度或交付记录。状态字节 SHA-256 为 `a02ec49a17a5978c3c98599948b8c67dff198795f85c71f1e1d499c8dc9c2008`。

[旧对话工作流截图](../artifacts/workflow-region-validation/final/live/old-conversation-workflow.png) 及 [可访问性快照](../artifacts/workflow-region-validation/final/live/old-conversation-ax.txt) 记录现有官方 header 下的实际渲染。截图及只读数据保留结果不改变前述精确左界、与原生标题顶部严格对齐及跨行红框未满足的结论。
