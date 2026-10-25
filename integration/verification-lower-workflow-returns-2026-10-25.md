# 0.21.3 工作流下方退回线验收

日期：2026-10-25。本轮只把显式退回箭头从节点上方移至名称下方，不改变原行高、节点与槽位坐标、标题或对话/轨迹位置，也不改变业务状态和权限。

## 最终归档

- [dsh-plugin-composable-workforce-0.21.3.tgz](../artifacts/dsh-plugin-composable-workforce-0.21.3.tgz)。
- SHA-256：`3caaccaa6cd0a6f6eb931e81da4f9d86a2cd514c7ec89703e43a0301e5839a44`。
- 1,039,626 bytes；356个文件逐项比较通过，禁止文件清单为空。见 [archive.json](../artifacts/workflow-lower-returns-validation/archive.json)。

## 绘制边界

保留同一场景原有的 `height`、`reserveTop`、`nodeY` 和可见窗口槽位，只改变SVG退回路径。路径由源圆下方45°圆周点出发，绕到名称左右边界外2px，经名称下方轨道，再回到目标圆下方45°圆周点；普通顺序线不变。

SVG的 `drawingHeight` 只使用原行下方已经存在的安全空白，增量最多23px，不参与文档流。插件自己的nav允许绘制溢出，SVG仍按自身画布裁剪，且 `pointer-events: none`，不拦截按钮。只读测量原生header和控件矩形，将tabs、正文及其他控件留在绘制范围外；初始安全空间为零，测量完成才允许绘线。ResizeObserver与MutationObserver均随组件卸载断开。

安全空间不足时整条退回线不绘制，计入详情提示；真实退回目标仍保留在节点描述与详情。不靠截断路径覆盖控件，不修改宿主祖先DOM/CSS。28px双圈、全局序号、灰白蓝状态、居中窗口、原生交互与业务校验继续沿用。

## 几何对照及验证

旧归档0.21.2的 [layout-baseline.json](../artifacts/workflow-lower-returns-validation/baseline-0.21.2/layout-baseline.json) 与最终0.21.3的 [native/report.json](../artifacts/workflow-lower-returns-validation/native/report.json) 已在独立官方环境逐场景对照。最终报告的 `laneLayouts` 确认零、一、三层场景的节点、名称、nav、标题、tabs及tab按钮矩形分别与对应旧基线精确一致。**这是同一场景前后不变，不是跨场景统一Y。**

| 场景 | 原行高保留 | 首个圆点Y保留 | 新SVG绘制高度 |
| --- | --- | --- | --- |
| 零层 | 52px | 12px | 52px |
| 一层 | 61px | 21px | 70px |
| 三层 | 75px | 35px | 98px |

原生路径采样中，名称命中、原生控件命中及裁剪样本均为零；退回端点位于半径14px的下方45°圆周，SVG点击穿透正常。窄屏隐藏目标仍保留真实语义，不绘制到省略符的虚构连线。

| 验证 | 本轮结果及范围 |
| --- | --- |
| 源码单元测试 | 16项通过；属于源码检查，不作为归档执行用例计数。 |
| 构建与只读审查 | 通过；[构建日志](../.local/workflow-lower-returns-build.log)。 |
| 最终归档生命周期 | 14/14；[report.json](../artifacts/lifecycle-0.21.3/report.json)、[执行日志](../artifacts/workflow-lower-returns-validation/lifecycle.log)、[汇总](../artifacts/workflow-lower-returns-validation/lifecycle-summary.json)，均绑定本记录的最终哈希。 |
| 最终归档原生工作流及几何对照 | 28/28；[native/report.json](../artifacts/workflow-lower-returns-validation/native/report.json)、[执行日志](../artifacts/workflow-lower-returns-validation/native-tests.log)，归档哈希匹配，页面异常为空。 |
| 最终归档语言 | 3/3；[语言报告](../artifacts/workflow-lower-returns-validation/native/locale-workflow-report.json)，名称、步骤内容和未提交验收意见保留，语言检查业务写入为零。 |

无tabs及原生popover没有另行构造独立原生场景；安全预算不足时省略整条路径的分支由单元测试覆盖，不将其声称为新增原生场景实测。

生命周期使用官方DSH `0.2.1-alpha.2`、39个官方运行时peer和独立临时profile。安装、普通卸载、原生运行、重装恢复及完全清理后，宿主28,779个程序文件摘要均为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`，知识清单前后相同。临时profile已删除，随机端口54393及对应临时进程已清理。本轮未重跑全量649项或员工67项。

## 当前环境

[实际安装报告](../artifacts/workflow-lower-returns-validation/live/installation.json) 已通过：版本0.21.3，归档哈希与本记录一致；三个构建文件与最终归档原字节相同，39个运行时peer解析至官方安装。

[数据保留报告](../artifacts/workflow-lower-returns-validation/live/data-preservation.json) 已通过：状态字节及API深比较、461个知识文件哈希、profile配置和两个旧对话工作流视图均未变。revision仍为115，两对话当前步骤仍为 `system-verification`（第8步），业务变更请求为零。未为视觉核对改选步骤或推进任务。
