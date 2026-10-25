# 0.25.2 工作流返回线顶部端点验收

日期：2026-10-25。目标版本：0.25.2。

**最终归档及本轮验收通过。** 0.25.2 的返回线两端均连接对应步骤圆顶，宿主标题、页签、正文与步骤位置保持不动。以下结果全部绑定本轮同一归档，不复用 0.25.1 的通过结果。

## 归档与检查状态

| 项目 | 当前状态 |
| --- | --- |
| 最终插件包 | [dsh-plugin-composable-workforce-0.25.2.tgz](../artifacts/dsh-plugin-composable-workforce-0.25.2.tgz) |
| SHA-256、大小与打包审核 | `c1068caa5352efedc4eebc348f74a6db738c00953416db0eb2681efc3051ca11`；1,065,363 字节、362 文件逐项对应；[归档审核](../artifacts/top-workflow-endpoints-validation/archive.json) |
| 类型与最终构建 | 均通过；[类型日志](../artifacts/top-workflow-endpoints-validation/typecheck.log)、[构建日志](../artifacts/top-workflow-endpoints-validation/build.log) |
| 端点单元 | 20/20；[布局单元日志](../artifacts/top-workflow-endpoints-validation/layout-unit-tests.log) |
| 官方原生端点、圆点命中及固定布局矩阵 | 30 项原生、3 项语言检查通过；16 组、48 个布局案例；[原生报告](../artifacts/top-workflow-endpoints-validation/native/report.json)、[归档与几何摘要](../artifacts/top-workflow-endpoints-validation/native-validation-summary.json) |
| 官方隔离生命周期 | 本轮最终归档重新运行 14/14；[生命周期报告](../artifacts/lifecycle-0.25.2/report.json) |
| 生命周期日志、宿主摘要与清理 | [执行日志](../artifacts/top-workflow-endpoints-validation/lifecycle.log)、[最终包与清理摘要](../artifacts/top-workflow-endpoints-validation/lifecycle-summary.json) |
| 本地安装、数据保留与实际截图 | 通过；[安装核对](../artifacts/top-workflow-endpoints-validation/live/installation.json)、[数据保留](../artifacts/top-workflow-endpoints-validation/live/data-preservation.json)、[实际界面核对](../artifacts/top-workflow-endpoints-validation/live/ui-checks.json) |
| 汇总及变更范围 | [最终证据摘要](../artifacts/top-workflow-endpoints-validation/verification.json)、[变更范围](../artifacts/top-workflow-endpoints-validation/change-scope.json) |

正式记录必须绑定同一最终归档 SHA-256。宿主边界、官方安装及完整卸载继续遵循 [ADR-001](../docs/decisions/001-official-plugin-boundary.md)、[安装说明](README.md) 与 [许可说明](THIRD_PARTY_NOTICES.md)。

## 本轮唯一行为变化

用户要求返回连线的出发与到达端点，均连接对应步骤圆的最顶点，而不是圆周右上／左上约 45° 的位置。本轮仅调整插件自有 `conversation-workflow-layout.ts` 的返回线几何；顺序线、节点、标签、状态、可见窗口及宿主布局维持原有规则。

对直径 28px 的实际步骤圆，端点为 `(centerX, centerY - 14)`。初层水平返回轨道放在圆顶上方 6px，轨道间距 5px、圆角 1px；目标端的向下箭头保留至少 5px 的直线段。自返回从同一个真实圆顶出发并回到该圆顶，以小回路表达本步骤重试，不造第二个节点或改变步骤语义。

插件固定 30px 流内占位、圆点与标签的坐标、标题、对话／轨迹页签和正文位置不因端点修正而移动。上方空间不足时沿既有安全规则省略整条返回线，并通过详情保留实际规则，不把不完整轨道裁断或画进文字／原生控件。

## 端点与固定布局结果

20 项源代码布局单元全部通过，验证普通返回、跨多步返回及自返回的源／目标端点等于对应圆顶，单元端点容差小于 `0.001px`，目标箭头方向与直线长度合理。隐藏或不存在的目标不产生虚假边，轨道容量及溢出规则仍有效。

最终归档在完整官方原生浏览器中通过 30 项功能／几何检查及 3 项语言检查，页面错误为空。结合真实圆点矩形、SVG 路径与箭头边界取样：共 34 条返回边，其中 17 条自返回；采样 15,085 个路径点、2,244 个箭头边界点。路径和箭头裁剪、标签命中、原生控件命中及圆内部碰撞计数全部为零，节点与标签仍可点击，绘图不截获事件。

68 个源／目标屏幕端点采用 `1/32px`（`0.03125px`）容差；最大横向误差 `0.02337646484375px`，最大纵向误差 `0px`。这包含 CSS `1/64px` 布局量化与 SVG 坐标舍入，不声明实际端点误差为零。首轮 `0.01px` 屏幕容差不足的诊断保存在 [独立诊断目录](../artifacts/top-workflow-endpoints-validation/attempt-subpixel-quantization/)；调整屏幕验证容差没有修改生产代码或归档，源单元的严格容差保持不变。

本轮最终归档重新执行同一会话“无／0／1／3／0”返回案例，以及中文／English、深／浅主题、`1512/1024/768/660` 共 16 组、48 个固定布局案例。流内占位均为 `30px`，原生标题、页签、正文与 scrollport 相对“无”的锚点最大偏差为零，标签与轨迹文字底部最大偏差为零。灰／白／蓝状态、详情、键盘焦点、滚动窗口及业务安全回归同时通过。原生进程自然退出，端口 `49913` 关闭、临时目录删除、残留临时进程为零。

## 官方边界与只读范围

所有调整发生在独立插件自有几何，继续使用官方公开 utilities 插槽；不修改 Harness 源码、构建物、内置插件、依赖或原生组件，不写宿主 DOM 或祖先样式。没有增加模型调用、知识重编、资料读取、业务请求或持久化字段。

[变更范围核对](../artifacts/top-workflow-endpoints-validation/change-scope.json) 确认唯一生产源代码变化为 `src/ui/conversation-workflow-layout.ts`；另有对应客户端构建物、包版本与说明文件更新。server、UI 组件、CSS 和共享 Wiki 编译引擎均未改变。本轮运行定向 20 项布局单元与完整原生回归，未重跑完整源代码测试套件，不沿用前轮全套计数。

## 官方隔离生命周期

唯一最终归档的 SHA-256、1,065,363 字节和版本 0.25.2 已在执行前独立核对，再使用完整官方发行版运行：

```sh
DSH_INSTALLATION_MANIFEST="$PWD/.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json" \
WORKFORCE_LIFECYCLE_UI=0 \
WORKFORCE_LIFECYCLE_REPORT_DIR="$PWD/artifacts/lifecycle-0.25.2" \
node tests/plugin-lifecycle.mjs artifacts/dsh-plugin-composable-workforce-0.25.2.tgz
```

最终归档在完整官方 DSH `0.2.1-alpha.2` 和独立临时 profile 中重新完成官方安装、核心功能、普通卸载、宿主原生能力、保留数据重装及完全 purge 共 14/14 项。报告 `tarballSha256` 与本记录最终归档一致。普通卸载及重装保留知识和业务记录，没有重复实例或任务重放；purge 移除本插件专属状态、知识与配置，同时保留用户成果和共享凭据夹具。

39 项 runtime peers 精确版本匹配并来自完整官方实体安装。宿主安装及依赖共 28,779 个程序文件，前后摘要同为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`，没有修改宿主程序文件。脚本自然退出后另核对本轮临时 profile 根目录已删除、端口 `49289` 拒绝连接、对应临时路径进程为零；不复用 0.25.1 的运行结果或端口。

该隔离测试未访问用户 `3081` 服务或生产数据，没有修改宿主或创建工作树。正式原生验证与生命周期针对同一个最终包、各用独立临时 profile 重新完成。

## 本地安装、数据保留与实拍

通过官方 CLI 安装并重启用户服务后，[安装报告](../artifacts/top-workflow-endpoints-validation/live/installation.json) 确认安装的 362 个打包文件全部与最终归档字节一致。39 项依赖均通过官方公开 runtime resolver 在独立只读进程中按实际 profile 重现为 `installation` 作用域，解析前后 profile 文件不变；这不是对运行服务模块堆内存的内省。

[数据保留报告](../artifacts/top-workflow-endpoints-validation/live/data-preservation.json) 确认 revision 仍为 `124`，状态文件字节及 API 状态完全一致，548 个知识文件哈希、profile 配置和全部 3 个既有会话视图均保持不变，业务写入请求为零。

实际 CUA 核对使用同一个既有原会话，比较更新前后的 [before-geometry.json](../artifacts/top-workflow-endpoints-validation/live/before-geometry.json) 与 [after-geometry.json](../artifacts/top-workflow-endpoints-validation/live/after-geometry.json)：header、标题、页签、轨迹、正文及全部 7 个节点的圆点、标签和文字矩形精确相同。没有切换工作流、步骤或验收，也没有发送提示或调用模型。

实际界面端点核对依据只读 DOM 矩形、已渲染 SVG 属性及 `preserveAspectRatio=none` 的 viewport 投影。CUA UI facade 未提供 `getPointAtLength`，本地实拍核对未声称使用该方法；完整路径／箭头取样由上述独立官方原生测试完成。两端实际最大横向误差约 `0.0198543px`、纵向约 `0.0113429px`，均小于 `1/32px`。浏览器保留该原会话，可直接查看结果。

![0.25.2 实际工作流圆顶返回端点](../artifacts/top-workflow-endpoints-validation/live/top-endpoints.png)

[实际截图与几何摘要](../artifacts/top-workflow-endpoints-validation/live/ui-checks.json) 和 [最终校验汇总](../artifacts/top-workflow-endpoints-validation/verification.json) 共同绑定最终归档，校验和检查通过。
