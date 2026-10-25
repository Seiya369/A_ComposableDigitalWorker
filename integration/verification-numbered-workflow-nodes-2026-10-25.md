# 0.21.1 工作流编号圆点验收

日期：2026-10-25。本轮仅调整顶部工作流节点的尺寸、双圈、序号及相应连线几何，保留官方公开插槽和原有交互。

## 最终归档

- 包：[dsh-plugin-composable-workforce-0.21.1.tgz](../artifacts/dsh-plugin-composable-workforce-0.21.1.tgz)。
- SHA-256：`2245755c26586a3bd399870c7879e2ea2d4aacf02a9c3de574ef327a90d5d935`。
- 1,036,868 bytes；356个文件逐项比较通过，禁止文件清单为空。见 [archive.json](../artifacts/workflow-numbered-nodes-validation/archive.json)。

## 确认的结果

节点为28×28px正圆，内部增加第二圈和居中黑色序号。宿主全局 `corner-shape: superellipse` 曾将50%圆角渲染为圆方形；最终包在插件圆点及其 `::before` 上明确指定 `corner-shape: round`，原生浏览器报告确认两层均为 `round`。

编号使用完整工作流中的原始序号，12步流程覆盖1至12；省略窗口移动后仍显示真实序号。最终报告的前置省略窗口显示5、6、7、8、9、10、11、12，未重新从1编号。标签仍在圆点下方，长名称省略，详情入口可见。

状态沿用灰色未完成、白色已验收、原生蓝色当前步骤。序号使用黑色、12px/600等宽数字。最终浏览器实测黑字对白色填充对比度21:1，对浅色主题蓝色约4.96:1、深色主题蓝色约9.02:1。色值及双圈指标见 [native/report.json](../artifacts/workflow-numbered-nodes-validation/native/report.json) 的 `acceptedNodeThemes`、`compactLayout`、`shiftedNumbering`。

布局 helper 的半径更新为14px，基础高度52px；一、二、三层退回轨道对应61/68/75px。顺序线及显式退回箭头从新圆周连接，隐藏端点不虚构连线。点击、状态推进、执行中保护、键盘、详情及中英切换继续使用既有逻辑。所有绘制仍限于 `conversation.session.header.utilities` 的插件子树；未修改宿主或扩大此前已说明的布局能力，精确左界、与原生标题顶部严格对齐及跨行红框仍不作达标声明。

## 本轮验证

| 项目 | 结果及证据 |
| --- | --- |
| 独立构建 | 通过，[build日志](../.local/workflow-numbered-nodes-build.log)。 |
| 最终归档原生工作流 | 25/25，通过报告内归档哈希核对；[报告](../artifacts/workflow-numbered-nodes-validation/native/report.json)、[日志](../artifacts/workflow-numbered-nodes-validation/native-tests.log)。覆盖28px双圈、正圆、全局编号、省略、深浅主题、真实验收后的状态色及既有交互；页面异常为空。 |
| 最终归档工作流语言 | 3/3，[语言报告](../artifacts/workflow-numbered-nodes-validation/native/locale-workflow-report.json)。系统文字跟随DSH，名称及未提交验收意见保留，语言切换无业务写入。 |
| 最终归档生命周期 | 14/14，[report.json](../artifacts/lifecycle-0.21.1/report.json)、[日志](../artifacts/workflow-numbered-nodes-validation/lifecycle.log)、[汇总](../artifacts/workflow-numbered-nodes-validation/lifecycle-summary.json)。 |
| 源码几何检查 | 本轮更新的9项 helper 测试通过，属于源码检查，无单独归档执行日志，不作为额外归档用例计数。 |

生命周期使用独立临时 profile 和官方 DSH `0.2.1-alpha.2`，39个运行时peer解析至官方安装。安装、普通卸载、原生运行、重装恢复和完全清理后，宿主28,779个程序文件摘要均为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`；知识前后清单一致。临时 profile 已删除，随机端口58576无监听，无对应残留进程。

本轮未重跑全量649项或员工67项，不能将之前版本的结果计入本轮。旧归档 `6c8d6754…` 的圆方形诊断与验收材料仅保存在 [attempt-1-superellipse](../artifacts/workflow-numbered-nodes-validation/attempt-1-superellipse)，不作为最终归档证据。

截图：[全局序号与省略](../artifacts/workflow-numbered-nodes-validation/native/native-numbered-steps-global-indices-dark.png)、[深色已验收/当前状态](../artifacts/workflow-numbered-nodes-validation/native/native-numbered-completed-dark.png)、[浅色已验收/当前状态](../artifacts/workflow-numbered-nodes-validation/native/native-numbered-completed-light.png)。

## 当前环境

[实际安装报告](../artifacts/workflow-numbered-nodes-validation/live/installation.json) 已通过：版本0.21.1，归档哈希为本记录的 `2245755c…`；`lib/index.js`、`lib/client.js`、`lib/llm-wiki/web.html` 与归档原字节一致，39个运行时peer解析至官方安装。

[数据保留报告](../artifacts/workflow-numbered-nodes-validation/live/data-preservation.json) 已通过：状态文件字节及API深比较相同，revision仍为103；461个知识文件哈希、profile配置及两个旧对话的工作流视图均未变，当前步骤仍为 `experience-design`。实际环境核对未发起业务变更请求，未为视觉验收更改步骤或推进任务。
