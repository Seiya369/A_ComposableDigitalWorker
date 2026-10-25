# 0.21.2 工作流居中窗口验收

日期：2026-10-25。本轮只调整顶部步骤条的显示窗口，继续使用官方公开 `conversation.session.header.utilities`，不改后端状态、验收规则、人员路由或权限。

## 最终归档

- [dsh-plugin-composable-workforce-0.21.2.tgz](../artifacts/dsh-plugin-composable-workforce-0.21.2.tgz)。
- SHA-256：`c3fdddb7efa961c1c84fa0611930f36e333de865eae4f8ca1f087cd9de7fef8b`。
- 1,037,967 bytes，356个文件精确比较通过，禁止文件清单为空。见 [archive.json](../artifacts/workflow-centered-window-validation/archive.json)。

## 窗口规则与实际结果

可见7个节点时，当前步骤1至4保持初始1–7窗口及原坐标；从第5步开始向后移动窗口，让当前步骤进入第4个槽位。到尾部后钳制为最后7步，不再为最后几个步骤继续移动；反向回到第1步恢复初始窗口。

最终归档的真实原生界面在1440px视口下提供7槽。报告的 `metrics.centeredWindow` 确认：

| 当前步骤 | 可见窗口 | 坐标行为 |
| --- | --- | --- |
| 1–4 | 1–7 | 槽位不移动，第4槽圆心X为877px。 |
| 5 | 2–8 | 第5步进入第4槽，圆心X仍为877px。 |
| 6 | 3–9 | 继续使用同一组槽位坐标。 |
| 9–12 | 6–12 | 尾窗保持，节点不因最后几次选择重新分配。 |
| 反向选择1 | 1–7 | 回到初始窗口和初始圆心坐标。 |

流程溢出时，两侧始终各预留24px省略槽，即使某一侧暂时没有省略按钮也保留空间，避免按钮出现或消失挤动节点。流程全部容纳时，两侧预留均为零，使用全部可用宽度。步骤条自身可用宽度仅28–75px时，取消省略槽以保留完整28px当前圆点，隐藏步骤通过外部详情入口查看；这不是28px浏览器视口承诺。

28px正圆双圈、全局序号、灰/白/蓝状态、名称截断与真实退回线保持。显示窗口依据已有当前步骤及测量宽度计算，不增加业务持久字段，不将隐藏或经过的步骤标为完成。用户点选仍走既有版本校验的切换逻辑；窗口移动不自动执行模型或扩大权限。

## 本轮验收

| 验证 | 结果与证据 |
| --- | --- |
| 构建 | 通过，[构建日志](../.local/workflow-centered-window-build.log)。 |
| 源码单元测试 | 14项通过，包含窗口首段、居中、尾段、逆向恢复、零预留及极窄条；属于源码检查，不计为归档执行用例。 |
| 最终归档原生工作流 | 26/26，[native/report.json](../artifacts/workflow-centered-window-validation/native/report.json)、[执行日志](../artifacts/workflow-centered-window-validation/native-tests.log)。报告归档哈希与本记录一致，页面异常为空。 |
| 最终归档语言 | 3/3，[语言报告](../artifacts/workflow-centered-window-validation/native/locale-workflow-report.json)。中英系统文字切换，步骤原名及未提交内容保留，语言检查业务写入为零。 |
| 最终归档生命周期 | 14/14，[report.json](../artifacts/lifecycle-0.21.2/report.json)、[日志](../artifacts/workflow-centered-window-validation/lifecycle.log)、[汇总](../artifacts/workflow-centered-window-validation/lifecycle-summary.json)。 |

生命周期使用官方DSH `0.2.1-alpha.2`、39个官方运行时peer和独立临时profile。安装、普通卸载、原生运行、重装及完全清理后，宿主28,779个程序文件摘要相同，均为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`；知识清单相同。临时profile已删除，随机端口51226及对应临时进程已清理。本轮未重跑全量649项或员工67项。

截图：[第4步原位](../artifacts/workflow-centered-window-validation/native/native-window-current-fourth-in-place-dark.png)、[第5步居中](../artifacts/workflow-centered-window-validation/native/native-window-current-fifth-centered-dark.png)、[尾窗钳制](../artifacts/workflow-centered-window-validation/native/native-window-tail-clamped-dark.png)。此前精确左界、与原生标题顶部严格对齐及跨行红框的布局限制没有因本次窗口算法改变。

## 当前环境

[安装报告](../artifacts/workflow-centered-window-validation/live/installation.json) 已通过：实际版本0.21.2、归档哈希与本记录一致，三个构建文件与归档原字节相同，39个运行时peer解析至官方安装。

[数据保留报告](../artifacts/workflow-centered-window-validation/live/data-preservation.json) 已通过：状态字节及API深比较相同，461个知识文件哈希、profile配置和两个旧对话工作流视图均未变。revision仍为111，两对话的当前步骤仍为 `test-design`（第4步）。本轮实际环境核对的业务变更请求为零，未为窗口验收改选步骤或推进任务。
