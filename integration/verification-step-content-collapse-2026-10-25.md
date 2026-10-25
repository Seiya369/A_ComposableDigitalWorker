# 0.25.4 步骤说明折叠验收

日期：2026-10-25。目标版本：0.25.4。

**最终归档与本轮验收通过。** 类型／构建、源码组件 14 项、官方原生 30 项、语言 3 项、生命周期 14 项以及本地只读界面检查均完成。安装前后保留了已观察到的并发步骤切换，数据比较范围在下文明确，不声明安装前后全状态字节相同。不复用前版包的通过记录。

## 归档与检查状态

| 项目 | 当前状态 |
| --- | --- |
| 最终插件包、SHA-256、大小及文件审计 | [0.25.4 插件包](../artifacts/dsh-plugin-composable-workforce-0.25.4.tgz)；`b2c578e9772031cd181f635cb3898f01d6b8372f02e02c2bd702b9d91766e51b`；1,066,316 字节、362 文件逐项匹配；[归档审核](../artifacts/step-content-collapse-validation/archive.json) |
| 类型检查与构建 | 通过；[类型日志](../artifacts/step-content-collapse-validation/typecheck.log)、[构建日志](../artifacts/step-content-collapse-validation/build.log) |
| 默认折叠、键盘及只读组件回归 | 源码夹具中 14/14，通过；[组件报告](../artifacts/step-content-collapse-validation/component/report.json)。这不是正式归档执行结果 |
| 官方原生／语言回归及固定布局矩阵 | 最终归档 30 项原生、3 项语言通过，16 组／48 个布局案例；[原生报告](../artifacts/step-content-collapse-validation/native/report.json)、[合并验收摘要](../artifacts/step-content-collapse-validation/validation-summary.json) |
| 官方隔离生命周期 | 本轮最终归档独立执行 14/14；[报告](../artifacts/lifecycle-0.25.4/report.json)、[日志](../artifacts/step-content-collapse-validation/lifecycle.log)、[依赖／宿主与清理摘要](../artifacts/step-content-collapse-validation/lifecycle-summary.json) |
| 本地安装与数据保留 | 安装通过；安装前后存在保留的并发步骤切换，不能称全状态字节一致；[安装](../artifacts/step-content-collapse-validation/live/installation.json)、[安装前后比较](../artifacts/step-content-collapse-validation/live/pre-install-preservation.json)、[切换后只读基线比较](../artifacts/step-content-collapse-validation/live/data-preservation.json) |
| 本地实拍 | 默认收起→展开→再次收起通过，交付／验收／退回始终显示；[界面报告](../artifacts/step-content-collapse-validation/live/ui-checks.json)、[收起截图](../artifacts/step-content-collapse-validation/live/collapsed.png)、[展开截图](../artifacts/step-content-collapse-validation/live/expanded.png) |
| 最终汇总与生产变更 | [最终验收](../artifacts/step-content-collapse-validation/verification.json)、[变更范围](../artifacts/step-content-collapse-validation/change-scope.json) |

正式结果必须绑定同一最终归档 SHA-256。官方扩展边界、安装与完整清理要求见 [ADR-001](../docs/decisions/001-official-plugin-boundary.md)、[安装说明](README.md) 与 [许可说明](THIRD_PARTY_NOTICES.md)。

## 本轮行为与边界

将“步骤内容”标题移到步骤名和负责人下方，以右侧三角控制“步骤说明”的展开与折叠，默认折叠。交付内容、验收标准及以下内容保持显示，不随步骤说明折叠。

折叠状态属于当前界面的原生 details 状态，不新增持久化字段。相同 session／instance／step 的语言切换保留同一 DOM 及其展开状态；切换步骤重建为默认折叠。从项目知识返回详情后重新默认折叠，但选中步骤和未提交验收备注保持原有行为。

[归档变更范围](../artifacts/step-content-collapse-validation/change-scope.json) 确认 0.25.3→0.25.4 仅两个生产源文件变化：插件自有 `src/ui/ConversationWorkflowDetails.tsx` 与 `src/ui/conversation-workflow-details.css`。顶部 header、server 和共享 Wiki 引擎未变。不修改 Harness 源码、构建物、内置插件或依赖，不替换原生组件、不写宿主 DOM 或祖先样式；没有新增服务、模型调用或业务数据写入。

## 组件与正式原生结果

源码组件夹具 14/14 通过，浏览器错误为空；被测组件及其相关文件与最终归档源文件哈希相同。检查覆盖默认不含 open 状态、鼠标与键盘展开／折叠、三角和标题的点击区域，以及折叠时交付内容和验收标准仍可见。语言切换保留当前展开状态、换步骤恢复默认折叠；历史交付和成果读取仍为只读，不激活步骤或提交验收。源码夹具的 transport 和 Wiki handshake 受控，不把它表述成正式归档或完整宿主执行。

组件同时覆盖详情独立滚动、项目知识往返、正文读取与未提交备注保留，16 组主题／语言／宽度和 5 个滚动／缩放案例通过。实际顺序为步骤身份／负责人在前，折叠标题在后，再是始终显示的交付与验收要求。

同一最终包在完整官方宿主、独立临时 profile 中重新完成 30 项原生与 3 项语言检查，页面错误为空、语言检查业务写入为空。强化默认折叠、键盘与鼠标、换步骤重置、仅说明折叠等检查，折叠交互未产生业务写入或模型调用。原生报告 SHA-256 为 `e4f996d9dd3539973c12cd62891ad1f8801168de81c1ef70940e162a2995d449`。

最终归档仍重新通过顶部中文／English、深／浅主题、`1512/1024/768/660` 的 16 组、48 个固定布局案例。流内占位保持 `30px`；相对“无”的原生锚点及标签文字底部最大偏差为零。详情中心核对覆盖 81 个图形、344 个圆点、74 个省略号与 9 个无省略号图形，中心最大纵向误差为零。圆顶端点最大 X 误差 `0.02337646484375px`、Y 误差 `0px`，满足 `1/32px` 屏幕量化容差；路径／箭头裁剪及标签、控件、圆内部碰撞计数均为零。

官方原生进程自然退出，端口 `55376` 关闭、临时目录删除、对应进程为零，宿主入口及 manifest 摘要前后一致。本轮未跑完整源代码测试套件或重新运行几何 helper 单元，不沿用前轮 20 项单元计数。

## 官方隔离生命周期

最终包 SHA-256、版本与字节数已在执行前独立核对，使用完整官方发行版运行：

```sh
DSH_INSTALLATION_MANIFEST="$PWD/.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json" \
WORKFORCE_LIFECYCLE_UI=0 \
WORKFORCE_LIFECYCLE_REPORT_DIR="$PWD/artifacts/lifecycle-0.25.4" \
node tests/plugin-lifecycle.mjs artifacts/dsh-plugin-composable-workforce-0.25.4.tgz
```

本轮最终归档在完整官方 DSH `0.2.1-alpha.2`、独立临时 profile 中完成官方安装、核心能力、普通卸载、原生宿主功能、保留数据重装和完全 purge 共 14/14 项，脚本自然退出码为零。普通卸载及重装保留原始业务与知识，没有重复实例或任务重放；完全 purge 移除插件专属状态及配置，并保留用户成果和共享凭据夹具。

39 项 runtime peers 在完整官方实体安装中按精确版本核对通过。宿主安装及依赖共 28,779 个程序文件，执行前后摘要均为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`。自然退出后独立核对临时 profile 根目录已删除，端口 `55439` 拒绝连接，对应临时进程为零。该生命周期未访问用户 `3081` 服务或生产数据，未修改宿主或创建工作树。

## 本地安装与数据比较边界

本地通过官方 CLI 安装同一最终包。[安装报告](../artifacts/step-content-collapse-validation/live/installation.json) 确认 362 个安装文件与归档字节完全匹配，39 项依赖在独立只读进程通过官方公开 runtime resolver 按实际 profile 重现为 `installation` 作用域，解析期间 profile 文件不变；这不是运行服务模块堆内存内省。

[安装前后比较](../artifacts/step-content-collapse-validation/live/pre-install-preservation.json) 明确记录 revision `128→129`，全状态字节不相同。服务重启就绪后观察到演示实例 `demo-preview-instance-cc20b862db4910c08dd2c9cb` 的并发步骤切换：`test-design→technical-review`、实例版本 `5→6`，以及对应 `updatedAt` 更新。除该实例的 `currentStepId`、`version`、`updatedAt` 与全局 revision 外，其余记录、默认值和会话覆盖保持不变，548 个知识文件哈希保留。验收保留该选择，没有回滚；本次验收发出的业务写入为零，不将观察到的切换归因为本轮 UI 改动。

[后续数据报告](../artifacts/step-content-collapse-validation/live/data-preservation.json) 使用上述切换后的 revision `129` 作为只读检查基线：状态字节及 API 一致，548 个知识文件哈希、profile 配置及全部 3 个会话视图保持不变，业务写入为零。该“相同”仅适用于切换后的基线比较，不能扩大为安装前后全状态字节一致。

## 实际只读界面与截图

[实际界面报告](../artifacts/step-content-collapse-validation/live/ui-checks.json) 记录在既有 `725ffeb0-a151-416c-be12-79828d400aae` 会话只读查看第 5 步“功能实现与开发自检”：负责人先于“步骤内容”标题，初始默认收起；点击后展开步骤说明，再点击恢复收起。收起时步骤说明不出现在可访问性树中，“交付内容”“验收标准”“退回目标”始终可见。

只读查看没有“设为当前”、提交验收或其他业务动作，真正当前步骤仍为第 7 步“界面与体验核验”。最终只读数据报告仍为 revision `129`，与保留并发切换后的基线一致。截图演示的是当前页面折叠行为，不把只读查看步骤当作工作流进度变更。

![0.25.4 步骤说明默认收起](../artifacts/step-content-collapse-validation/live/collapsed.png)

![0.25.4 展开步骤说明](../artifacts/step-content-collapse-validation/live/expanded.png)

[最终验收汇总](../artifacts/step-content-collapse-validation/verification.json) 绑定本轮同一归档、源码组件、正式原生、生命周期及本地只读检查，校验和检查通过。安装前后并发切换的例外与后续只读基线保持分开，未回滚用户选择，也没有用旧版结果替代本轮验证。
