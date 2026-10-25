# 0.25.3 工作流详情按钮中心对齐验收

日期：2026-10-25。目标版本：0.25.3。

**最终归档与本轮验收通过。** 顶部“详情”按钮中心已与省略号中线对齐，节点、标签、省略号和宿主布局保持原位。以下结果均绑定本轮唯一最终包，不复用 0.25.2 的通过记录。

## 归档与检查状态

| 项目 | 当前状态 |
| --- | --- |
| 最终插件包、SHA-256、大小与文件审计 | [0.25.3 插件包](../artifacts/dsh-plugin-composable-workforce-0.25.3.tgz)；`685b928a65a65213aff3fec11cbeeeba8a037a925bcfb8c9c4e05bdcfc796f3d`；1,065,565 字节、362 文件逐项匹配；[归档审核](../artifacts/details-center-alignment-validation/archive.json) |
| 类型检查与构建 | 通过；[类型日志](../artifacts/details-center-alignment-validation/typecheck.log)、[构建日志](../artifacts/details-center-alignment-validation/build.log) |
| 官方原生检查与语言回归 | 30 项原生、3 项语言检查通过；[原生报告](../artifacts/details-center-alignment-validation/native/report.json)、[验收摘要](../artifacts/details-center-alignment-validation/native-validation-summary.json) |
| 详情按钮与省略号中心对齐 | 81 个图形样本、344 个圆点、74 个省略号及 9 个无省略号图形通过；原生实测中心纵向最大误差为零，容差 `1/32px` |
| 官方隔离生命周期 | 本轮最终归档独立执行 14/14；[报告](../artifacts/lifecycle-0.25.3/report.json)、[日志](../artifacts/details-center-alignment-validation/lifecycle.log)、[依赖／宿主与清理摘要](../artifacts/details-center-alignment-validation/lifecycle-summary.json) |
| 本地安装、数据保留与实际截图 | 通过；[安装](../artifacts/details-center-alignment-validation/live/installation.json)、[数据保留](../artifacts/details-center-alignment-validation/live/data-preservation.json)、[实拍测量](../artifacts/details-center-alignment-validation/live/ui-checks.json) |
| 最终归档证据及变更范围 | [验收汇总](../artifacts/details-center-alignment-validation/verification.json)、[变更范围](../artifacts/details-center-alignment-validation/change-scope.json) |

正式结果必须绑定同一归档 SHA-256。官方扩展边界、安装与清理要求见 [ADR-001](../docs/decisions/001-official-plugin-boundary.md)、[安装说明](README.md) 与 [许可说明](THIRD_PARTY_NOTICES.md)。

## 本轮变化与边界

本轮仅调整插件自有 `src/ui/ConversationWorkflow.tsx` 中顶部“详情”按钮的一行 inline transform，使其中心与工作流省略号“…”的中线对齐。偏移依据自有图形几何 `graph.nodeY - graph.height / 2` 计算，不改变节点、步骤标签、固定流内占位、宿主标题、页签或正文的位置。

不修改 Harness 源码、构建物、内置插件或依赖，不替换原生组件，不写宿主 DOM 或祖先样式。没有新增模型调用、业务字段、知识重编或持久化动作。[变更范围报告](../artifacts/details-center-alignment-validation/change-scope.json) 确认唯一生产源代码变化为该 TSX 文件，几何 helper、CSS、server 和共享 Wiki 引擎未变；另有客户端构建、包版本及对应说明更新。

## 原生验收结果

在本轮最终归档上读取实际“详情”按钮、圆点和省略号的屏幕中心，中心纵坐标差采用 `1/32px`（`0.03125px`）的严格容差。81 个图形样本覆盖 344 个圆点、74 个省略号及 9 个无省略号图形；原生测试中详情与圆点／省略号元素中心的最大纵向误差均为 `0px`。无省略号时仍对齐步骤圆心。

本轮重新通过同一会话“无／0／1／3／0”返回场景，以及中文／English、深／浅主题、`1512/1024/768/660` 共 16 组、48 个固定布局案例。覆盖窗口平移、验收状态变化和没有省略号的完整窗口，全部 30 项原生与 3 项语言回归通过，页面错误为空。按钮可点击、节点和标签命中、键盘焦点、宿主锚点与圆顶返回路径均未回退。

流内占位保持 `30px`，相对“无”的宿主锚点最大偏差及标签文字底部偏差均为零。68 个圆顶端点的最大横向误差仍为 `0.02337646484375px`、纵向为 `0px`，满足 `1/32px` 的屏幕量化容差；不将这些返回端点误差表述为全零。原生路径／箭头的裁剪、标签、控件及圆内部碰撞计数均为零。

原生运行自然退出码为零，端口 `51182` 关闭，独立临时目录删除，临时进程残留为零；官方宿主入口及 manifest 的前后摘要一致。原生报告 SHA-256 为 `c333738dd2cee360b9c89b6a144f52368e612f3406bc1518630d583b4ea2d9f9`。

## 官方隔离生命周期

唯一最终归档 SHA-256、版本及字节数已在执行前独立核对，使用完整官方发行版运行：

```sh
DSH_INSTALLATION_MANIFEST="$PWD/.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json" \
WORKFORCE_LIFECYCLE_UI=0 \
WORKFORCE_LIFECYCLE_REPORT_DIR="$PWD/artifacts/lifecycle-0.25.3" \
node tests/plugin-lifecycle.mjs artifacts/dsh-plugin-composable-workforce-0.25.3.tgz
```

本轮最终归档在完整官方 DSH `0.2.1-alpha.2` 的独立临时 profile 中完成官方安装、核心能力、普通卸载、原生能力、保留数据重装及完全 purge 共 14/14 项，脚本自然退出码为零。普通卸载与重装保留原始业务和知识，没有重复实例或任务重放；完全 purge 移除插件专属状态及配置，并保留用户成果和共享凭据夹具。

39 项 runtime peers 在完整官方实体安装中按精确版本核对通过。宿主安装与依赖共 28,779 个程序文件，执行前后摘要均为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`。自然退出后独立核对临时 profile 根目录已删除，端口 `51244` 拒绝连接，对应临时进程为零。该生命周期测试未访问或修改用户 `3081` 服务及生产数据，没有修改宿主或创建工作树。

## 本地安装、数据保留与实际界面

通过官方 CLI 安装同一最终包并重启本地服务后，[安装报告](../artifacts/details-center-alignment-validation/live/installation.json) 确认 362 个安装文件全部与归档字节匹配。39 项依赖经官方公开 runtime resolver，在独立只读进程按实际 profile 重现为 `installation` 作用域，解析前后 profile 文件不变；这是公开解析的只读复现，不是运行服务模块堆内存内省。

[数据保留报告](../artifacts/details-center-alignment-validation/live/data-preservation.json) 确认 revision 仍为 `124`，状态文件字节及 API 全同；548 个知识文件哈希、profile 配置及全部 3 个既有会话视图均保持不变，业务写入请求为零。

实际 CUA 核对的是同一个既有会话更新前后的 [before-geometry.json](../artifacts/details-center-alignment-validation/live/before-geometry.json) 与 [after-geometry.json](../artifacts/details-center-alignment-validation/live/after-geometry.json)：header、标题、页签、正文、全部 7 个节点的圆点和标签，以及两个省略号的元素及文字矩形精确相同。仅详情按钮的视觉 Y 位置移动，X 和宽度不变；矩形高度的浮点差为 `0.0000019073486328125px`，属于测量精度差异，并非布局高度变化。

实际详情元素中心 Y 为 `32.78784942626953px`，两个省略号元素中心 Y 均为 `32.78211975097656px`，最大差 `0.00572967529296875px`，小于 `1/32px`，不宣称实拍误差为零。测量来自工具实际提供的只读 DOM 矩形；没有切换工作流、步骤、验收或调用模型。浏览器保留该原会话。

![0.25.3 详情与省略号中心对齐](../artifacts/details-center-alignment-validation/live/details-centered.png)

本轮是一处 TSX 样式计算调整，未修改几何 helper，未新跑布局单元或完整源代码测试套件，不将前轮 20 项单元作为本轮计数。类型／构建、最终归档上的原生几何／语言回归、独立生命周期和实际安装核对构成本轮证据，最终校验和检查通过。
