# 0.24.0 顶部工作流与阶段详情验收

日期：2026-10-25。本记录绑定同一份最终 npm 归档；不以旧归档或补丁宿主上的结果代替。

- 归档：[dsh-plugin-composable-workforce-0.24.0.tgz](../artifacts/dsh-plugin-composable-workforce-0.24.0.tgz)。
- SHA-256：`81eb0912cf946d50d0cb688556fcde67375ab699f07bfe24f5e1dfea16b066f0`；1052741 bytes，360项包内文件与冻结源码逐项匹配，禁止文件清单为空。见 [archive.json](../artifacts/workflow-details-refresh-validation/archive.json) 与随包校验文件。
- 官方宿主：未修改 npm 发行版 DSH 0.2.1-alpha.2；Node/Harness范围、peer依赖、安装/两种卸载及许可说明沿用包内 manifest、README、integration/README 与 LICENSES.md，不扩大兼容范围。

## 修改后的行为

顶部保留原有nav/bar占位、标题、详情及原生tabs位置，节点/名称/顺序线/省略提示在安全空白内整体下移0–12px。回退虚线走圆点上方，真实端点、自回环和最多三层轨道保留；静态省略号不可点击且不入焦点，首尾隐藏真实邻接步骤时显示短连线。安全余量不足时减小平移量，不通过修改宿主祖先或撑高header达成。

详情左侧完整竖向步骤，右侧阶段文件快照、交付状态、负责人、时间及验收意见；要求/退回、任务、历史与回复默认折叠。浏览步骤只读；设为当前和人工验收继续采用既有原生归属、busy、revision/instance/run版本校验。已完成步骤按有效completion.runId展示验收成果；当前步骤显示最新尝试，避免旧验收挡住新待验收；明确选择历史版本则显示该版本。返工后失效成果保留历史。

项目Wiki入口位于详情顶部，复用冻结项目团队共享空间。只读查看已有知识、整理状态、正文及来源，不因打开触发模型、上传或重编。阶段快照缺少文本或截断时明确显示；不提供未经验证的任意文件打开/下载链接，保留原生对话回溯。

## 验证及范围

| 验证 | 结果与证据 |
| --- | --- |
| 全量源码单元测试 | 673/673；[日志](../.local/workflow-details-refresh-tests.log)。在最终焦点/CSS导入顺序和当前步骤优先新交付三项UI修复前执行，修复后由下列组件及最终归档原生检查覆盖，不冒称再次全量执行。 |
| TypeScript与构建 | 通过；[最终构建日志](../.local/workflow-details-refresh-build-final.log)。最终归档只在首次归档后补齐README说明，三个构建文件字节保持一致。 |
| 详情浏览器组件 | 11/11；[report.json](../artifacts/workflow-details-refresh-validation/component/report.json)。中英320/768/1024/1440px、1040px桌面详情、只读选择、文件快照、有效验收、当前新交付、快速选择迟到响应、Wiki状态与只读握手、CAS不重放、退回原因及焦点恢复。Wiki ready场景使用受控iframe，不能称为真实打包Wiki渲染验收。 |
| 最终归档原生对话工作流 | 27/27；[native/report.json](../artifacts/workflow-details-refresh-validation/native/report.json)。含中英3项、人工验收/返工、None与历史原生对话、28px双圈、上方回退、真实窗口短线及宽窄屏。pageErrors为空。 |
| 同场景几何对照 | 最终归档零/一/三层轨道相对独立0.21.2官方基线，nav/bar/原生标题/tabs矩形保持；node/label仅增加测得offsetY，不以跨场景统一Y代替同场景对照。详见native报告的laneLayouts。 |
| 最终归档官方生命周期 | 14/14；[report.json](../artifacts/lifecycle-0.24.0/report.json)，安装、使用、普通卸载、原生运行、重装恢复、完全清理、知识保留、共享引擎退出及官方宿主完整性。 |

生命周期安装使用独立临时profile及实际归档，39个官方运行时peer。宿主28779个程序文件安装/卸载前后摘要相同：`91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`。临时profile及随机端口服务由测试finally清理；未删除现有用户项目、成果、会话、凭据或知识。未声称重跑完整员工设置/知识图谱界面回归。

## 本地安装

最终归档已通过官方CLI安装到本地profile并重启3081服务。为避开包管理器同版本/同路径缓存，实际安装使用hash目录中的同字节归档副本；主交付归档与该副本SHA-256相同。见[installation.json](../artifacts/workflow-details-refresh-validation/live/installation.json)，360项已安装文件与最终归档逐项一致。

[data-preservation.json](../artifacts/workflow-details-refresh-validation/live/data-preservation.json)确认状态文件原字节/API深比较、revision115、两个待验收根交付、四个已存对话工作流视图和插件profile配置保持。原有461个知识文件哈希全部保留、无修改或删除；浏览既有团队库时，既有knowledgeLibrary GET通过syncCategoryDirectories补齐4个分类目录index.json派生索引，因此当前共465个文件。它们不是新的来源/知识版本或模型编纂结果，不把整个知识目录谎称为字节全同。未清理这些用户库下由服务维护的索引。

[ui-report.json](../artifacts/workflow-details-refresh-validation/live/ui-report.json)记录实际旧原生对话：顶部下移12px，完整12步，当前可见5–12步；左侧12px短线指向真实隐藏前邻，省略符为不可聚焦span。详情/项目Wiki实际入口可用，当前团队Wiki如实显示等待整理；不声称本地已有完成的Wiki正文。页面异常与业务变更请求均为空；读完后再次核对状态、视图和原知识文件哈希。实际效果见[顶部](../artifacts/workflow-details-refresh-validation/live/workflow-header.png)、[详情](../artifacts/workflow-details-refresh-validation/live/workflow-details.png)、[Wiki](../artifacts/workflow-details-refresh-validation/live/project-wiki.png)。
