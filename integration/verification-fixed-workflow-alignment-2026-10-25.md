# 0.25.1 工作流固定对齐验收

日期：2026-10-25。版本：0.25.1。

**最终 `fe086…c637` 归档已通过类型检查、几何单元 20/20、构建、严格原生 30/30、语言 3/3、新运行的官方生命周期 14/14，以及用户本地安装、数据保留与实际界面核对。** 原生严检曾发现标签层叠命中与首层轨道位置缺陷，两个中间候选及各自生命周期均只作诊断。本轮没有重跑整套源码测试，不将 0.25.0 或旧候选的结果冒充本轮全套通过。

## 归档与检查状态

| 项目 | 当前状态 |
| --- | --- |
| 最终插件包 | [dsh-plugin-composable-workforce-0.25.1.tgz](../artifacts/dsh-plugin-composable-workforce-0.25.1.tgz) |
| SHA-256、大小与打包审核 | `fe086cac5820d73f94556941c1a922464cbf6b8b69753c1c121761460a7fc637`；1,064,753 字节、362 个文件对应核对；[归档审核](../artifacts/fixed-workflow-alignment-validation/archive.json) |
| 类型、几何单元及最终构建 | 类型检查通过，最终几何 20/20、构建 exit 0；[单元日志](../artifacts/fixed-workflow-alignment-validation/layout-unit-tests.log)、[最终构建日志](../artifacts/fixed-workflow-alignment-validation/build-final.log) |
| 官方归档原生几何、交互及语言 | 同一最终包 30/30、语言 3/3；[正式原生报告](../artifacts/fixed-workflow-alignment-validation/native/report.json)、[矩阵与清理汇总](../artifacts/fixed-workflow-alignment-validation/native-validation-summary.json) |
| 官方隔离生命周期 | 同一最终包重新运行 14/14；[生命周期报告](../artifacts/lifecycle-0.25.1/report.json) |
| 生命周期日志与清理摘要 | [最终包日志](../artifacts/fixed-workflow-alignment-validation/lifecycle.log)、[最终包与清理摘要](../artifacts/fixed-workflow-alignment-validation/lifecycle-summary.json)；两轮旧报告仅诊断 |
| 本地安装、业务数据保留与实际截图 | 正式安装、全部原数据与三对话视图保留、实际无／有返回对照通过；[安装](../artifacts/fixed-workflow-alignment-validation/live/installation.json)、[数据保留](../artifacts/fixed-workflow-alignment-validation/live/data-preservation.json)、[界面核对](../artifacts/fixed-workflow-alignment-validation/live/ui-checks.json) |

正式记录需绑定同一个最终归档 SHA-256。安装、宿主边界和完全卸载继续遵循 [ADR-001](../docs/decisions/001-official-plugin-boundary.md)、[安装说明](README.md) 与 [许可说明](THIRD_PARTY_NOTICES.md)。

## 问题与目标

此前插件将 `52 + reserveTop` 的图谱高度放在原生标题同行的 utilities 流内。当返回轨道数量变化时，自有内容抬高该行，使原生标题、对话／轨迹页签和正文位置变化。只比较旧版逐案例的坐标，不能证明不同返回轨道场景之间的宿主位置固定。

本轮目标是在相同原生会话、视口和宿主状态下，切换无返回、一层或多层返回轨道、可见步骤窗口及选中步骤时，原生标题、页签与正文的纵向锚点保持不动。工作流步骤标签的文字底部与原生轨迹页签的文字底部对齐；返回连线仅在节点上方绘制，不通过抬高宿主行或把连线挪至标签下方实现。

## 官方边界与允许实现

官方 `conversation.session.header.utilities` 是 session 范围的列表插槽，面向右侧工具，不向插件传入宿主几何。官方 `0.2.1-alpha.2` 的 session header 将 titleCluster 与 headerUtilities 放在同一条 `align-items:center` 的 flex titleRow 内，页签是随后独立的一行。插件流内高度会参与宿主布局，这解释了原有跳动。

修复只能调整插件自身的占位、节点、标签和 SVG。允许只读测量 header、公开 `data-conversation-tabs` 与自有元素的矩形、文字 Range，并在自有容器中绝对定位或平移；不得写宿主 DOM／样式、替换原生组件、用祖先 CSS 重排原生标题或页签，或修改 Harness 构建物与依赖。

最终实现将自有布局占位固定为 30px，`reserveTop` 为零；节点和标签在插件内绝对定位，返回线数量不再参与流内高度。标签测量使用原生页签文字 Range 和自有固定字体探针，再按标签文字量测补正；不是以含底部 padding 的按钮底边代替文字。返回 SVG 允许负 `drawingTop` 扩展自身上方绘图范围，不增加原生行高。

绘图保持 `pointer-events:none`；自有 bar 的定位与层级保证可见标签仍归属插件按钮点击，不被原生 tabs 的层叠覆盖，同时不覆盖原生控件区域。没有可见页签或空间不足以安全对齐标签时保留 30px 圆点行，隐藏视觉标签但保留按钮名称、title 与详情入口；上方空间不足容纳整条返回线时不画该线，保留真实退回语义和详情提示，不裁断或侵入原生控件。实际原生文字对齐、点击命中和控件位置已按修后归档验证，降级没有通过修改宿主来扩大空间。

所有新增观察器、监听和图形资源只属于插件，切换会话、卸载或解除挂载时必须清理。显示量测不激活步骤、不改变完成记录、不调用模型，也不写业务数据。

## 本轮几何与交互验收范围

在相同会话与视口内直接对比 0／1／3 层返回案例、不同步骤窗口、选中与已完成状态，核对原生标题、页签以及正文／scrollport 的 y 和高度。另测节点、标签文字及原生页签文字的真实矩形，证明标签底部对齐；连线端点连接实际节点圆周，水平轨道在上方，避开标签和原生控件，完整可见。

保留双圈序号、灰／白／蓝状态、居中窗口与末尾夹住位置、窄视口、长标签、键盘焦点、详情和无工作流等行为。深浅主题与中英文使用同一几何规则；原生标题和对话／轨迹仍可用，正文不被插件覆盖。

旧 0.21.2 的逐案例 baseline 只作为历史参照；本轮跨场景不变必须由本轮同会话、同视口的直接比较证明，不能从各自历史 baseline 推导。没有页签、过窄空间或原生控件出现／消失时的行为另行标注，不隐藏未满足项。

## 旧候选诊断与修后重验

旧候选 SHA-256 为 `d162338e8e44bfaf2a750b6ef848c0464b93cc873a714a2c3212cb254323afed`。早期原生尝试分别保留在 [旧行高预期诊断](../artifacts/fixed-workflow-alignment-validation/attempt-stale-row-height/) 和 [标签点击命中诊断](../artifacts/fixed-workflow-alignment-validation/attempt-label-hit-target/)，不计入最终通过。后者发现真实标签会被原生 tabs 的 `z-index:1` 层挡住，不能用仅有几何正确或隔离组件通过来忽略。

修复先为插件自有 bar 增加相对定位与层级，保持同一坐标和宿主布局，不改原生 tabs。旧 `d162…` 的 14 项生命周期仍是真实的旧哈希记录，但已移到 [层叠修正前生命周期目录](../artifacts/fixed-workflow-alignment-validation/attempt-before-stacking/)，其摘要标明 `diagnostic-only-superseded` 与 `finalValidation:false`。

随后 `58efb3f24c9f46a73f6bbaf7aa39c0402c1c8e167e0e3af69f0d9796a70b4051` 候选通过真实标签点击检查，但严格原生几何发现首层返回水平轨道比圆点 crown 低约 0.101px，仍不符合“位于圆点上方”。检查没有放宽断言；源码将轨道 lift 从 4 改为 5，固定 30px 占位和节点／标签位置不变。`58ef…` 生命周期虽完成 14 项，也已移到 [轨道修正前诊断目录](../artifacts/fixed-workflow-alignment-validation/attempt-before-track-lift/)，不得当作下一候选通过。

同一版本号下必须按最终新哈希重新运行全部原生严度和官方生命周期，不能只凭 0.25.1 版本号混用记录。轨道 lift 改为 5 后，最终 `fe086…c637` 通过原生全部严度，再单独执行最终生命周期；旧候选记录未计入这些通过数量。

## 最终归档的严格原生验证

最终归档在完整官方安装与独立临时 profile 中通过 30 项原生检查，语言子检查 3 项通过，`pageErrors` 为空，runner 自然退出为零。报告的 `metrics.pluginArchive.sha256` 为最终 `fe086…c637`，正式报告 SHA-256 为 `8da14c3df74d3c6c126225d2731b7434934b8e0f63c377ac503da5582b7c40ce`，不依赖旧候选结果。

固定位置由本轮直接比较证明：先捕获无工作流的原生 header／title／tabs／utility／body／scrollport 锚点，再在同一会话和视口依次选择 0／1／3／0 返回轨道场景。另在中文／English、深／浅主题、宽度 `1512/1024/768/660` 共 16 组内各自以“无”为基线比较“0／3／0”返回变化，共 48 个有工作流案例。原生纵向锚点最大偏差为 0px，标签与轨迹真实文字 Range 底部最大偏差也为 0px；固定布局占位始终 30px，节点顶部始终 19px。不是从旧逐案例 baseline 推导跨场景固定。

节点与标签真实点击命中插件按钮，上方返回线端点落在真实圆周，水平轨道位于圆点 crown 上方，避开文字与原生控件，线条完整无裁剪；省略窗口不制造隐藏目标边，也没有横向滚动。真实验收后灰／白／蓝状态变化、步骤选择和窗口移动均不推移标题、页签、正文或节点文字的 y。序号双圈、原生模型／权限、委派、草稿与附件恢复、严格验收和退回的既有安全语义也保留。

原生报告中返回线裁剪采样、标签相交与原生控件相交均为零。临时 runner 和宿主进程已退出，端口 `62945` 关闭，profile 与对应进程无残留，浏览器由 runner 关闭；宿主入口和 manifest 前后摘要一致。详见最终原生汇总，不以旧 attempt 的关闭状态代替。

## 官方生命周期

最终候选原生通过后，执行前再次独立核对 `fe086…c637` 归档、1,064,753 字节与版本 0.25.1，再使用完整官方发行版运行：

```sh
DSH_INSTALLATION_MANIFEST="$PWD/.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json" \
WORKFORCE_LIFECYCLE_UI=0 \
WORKFORCE_LIFECYCLE_REPORT_DIR="$PWD/artifacts/lifecycle-0.25.1" \
node tests/plugin-lifecycle.mjs artifacts/dsh-plugin-composable-workforce-0.25.1.tgz
```

最终归档在官方 DSH `0.2.1-alpha.2` 的独立临时 profile 中重新完成 14/14 项安装、核心使用、卸载、宿主原生能力、保留数据重装与 purge。普通卸载与重装保持知识和业务记录相同，没有重复实例或任务重放；完整清理移除本插件专属状态、知识和配置，同时保留用户成果与共享凭据夹具。

最终运行核对 39 项 peers 精确版本来自完整官方实体安装，宿主及依赖共 28,779 个程序文件，前后摘要同为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`。脚本自然退出后独立核对本次临时 profile 根目录已删除、端口 `63259` 拒绝连接、对应临时路径进程为零；报告和摘要均绑定最终 `fe086…c637`。

旧 `d162…` 与 `58ef…` 两轮也曾结束并清理各自临时环境，但只留在各自 attempt 目录；最终 14 项与上述端口／摘要为新运行，没有拿中间候选冒充。

隔离测试未访问用户 `3081` 服务或生产数据，没有创建工作树或修改宿主。最终本地安装、真实工作流进度与演示实例保留情况按下一节独立报告记录，不以生命周期代替。

## 本地安装、完整数据保留与实际对照

用户本地通过官方 CLI 安装最终 0.25.1 并重启，安装报告的 SHA-256 为本记录唯一最终 `fe086…c637`，所有 362 个包内文件逐字节匹配。39 项 peers 的精确版本与官方范围通过公开运行时解析器在独立验证进程只读复现；这不是对运行服务模块内存的内省。复现没有改动 profile 文件、宿主依赖或祖先依赖。

本轮仅修改三个生产源文件：`ConversationWorkflow.tsx`、`conversation-workflow-graph.css`、`conversation-workflow-layout.ts`。server 与共享知识编译引擎字节保持上一版原样，其他变化限 client 构建、类型声明、版本与说明。见 [变更范围核对](../artifacts/fixed-workflow-alignment-validation/change-scope.json)。本轮未重跑整套源码测试，新的验收范围是类型检查、20 项布局单元、30 项完整原生回归及 3 项语言、14 项生命周期，以及实际安装和几何核对。

安装前后状态文件字节和 API 状态完全相同，revision 保持 124，状态文件 SHA-256 为 `6c7038003623e03c1e64126c21220ea6e1573126353fe922ca8d1493487105c2`。548 个知识文件哈希、profile 配置，以及全部三个既有对话视图（含演示）逐项相同；本轮没有新增演示选项、变更真实或演示工作流进度，`mutatingLiveRequests` 为零。

实际 CUA 核对只切换两个已经存在的对话，没有改选工作流、激活步骤或验收。演示对话当前第 4 步、可见返回线为零，原有对话当前第 7 步、可见返回线为一。两份只读几何的原生 header、tabs、轨迹文字和 body 矩形精确相同，七个可见圆点位置也全部相同；步骤标签文字与轨迹文字底部差最大为 `0.0003662109375px`。

这是**两个既有会话之间的实际对照**，不是在用户环境切换“无／0／1／3／0”获得的结果。同一会话的完整基线与轨道切换不变性由前述独立官方原生矩阵证明，二者不能混淆。报告：[无返回几何](../artifacts/fixed-workflow-alignment-validation/live/without-return-geometry.json)、[有返回几何](../artifacts/fixed-workflow-alignment-validation/live/with-return-geometry.json)。

实际截图：[演示对话，无可见返回线](../artifacts/fixed-workflow-alignment-validation/live/without-return.png)、[原有对话，返回线在圆点上方](../artifacts/fixed-workflow-alignment-validation/live/with-return.png)。浏览器保留后一个原有对话，可直接查看最终效果。[最终验证汇总](../artifacts/fixed-workflow-alignment-validation/verification.json) 绑定归档与各类证据哈希，发布校验和复核与最终归档一致。
