# 0.23.1 知识图谱细线验收

日期：2026-10-25。版本：0.23.1。

**最终归档、图谱相关单元 20/20、严格 Wiki Web 类型检查、构建、源码双渲染器专项、官方归档生命周期 14/14，以及本地安装与数据保留核对均通过。** 本次仅调整图谱线条显示。0.23.0 的完整员工 78 项与语言 9 项、完整源码 669 项结果属于上一版，本轮未重跑，也不作为本轮新归档的通过记录。

## 归档与检查状态

| 项目 | 当前状态 |
| --- | --- |
| 最终插件包 | [dsh-plugin-composable-workforce-0.23.1.tgz](../artifacts/dsh-plugin-composable-workforce-0.23.1.tgz) |
| SHA-256、大小与包内文件审核 | `5f259ad82a112b281b35decd9469dd2b761b88f9df3c345807036fc55c968efe`；1,042,068 字节；356/356 文件核对，禁止文件清单为空；[归档审核](../artifacts/wiki-thin-lines-validation/archive.json) |
| 本轮图谱相关单元检查与构建 | 20/20，严格 Wiki Web TS 与构建 exit 0；[单元日志](../artifacts/wiki-thin-lines-validation/graph-tests.log)、[类型检查日志](../artifacts/wiki-thin-lines-validation/wiki-typecheck.log)、[构建日志](../artifacts/wiki-thin-lines-validation/build.log) |
| 源码双渲染器专项 | Sigma／SVG 细线连续可读、原有强拖动与适配回归通过；[专项摘要](../artifacts/wiki-thin-lines-validation/component-validation-summary.json) |
| 本轮员工完整界面／语言回归 | 按变更范围不重跑，不声明 78/78 或 9/9 |
| 官方归档生命周期 | 最终归档 14/14；[生命周期报告](../artifacts/lifecycle-0.23.1/report.json) |
| 生命周期日志与清理摘要 | [执行日志](../artifacts/wiki-thin-lines-validation/lifecycle.log)、[归档／执行根／清理摘要](../artifacts/wiki-thin-lines-validation/lifecycle-summary.json) |
| 实际安装与数据保留 | 最终哈希对应安装和保留记录均通过；[安装记录](../artifacts/wiki-thin-lines-validation/live/installation.json)、[数据保留记录](../artifacts/wiki-thin-lines-validation/live/data-preservation.json) |

所有本轮归档检查必须绑定同一个最终 SHA-256。安装、卸载和宿主边界继续遵循 [ADR-001](../docs/decisions/001-official-plugin-boundary.md)、[安装说明](README.md) 与 [许可说明](THIRD_PARTY_NOTICES.md)。上一版范围与证据见 [0.23.0 验收记录](verification-circular-knowledge-2026-10-25.md)。

## 实现范围与显示要求

本轮只压低插件图谱中 Sigma 和 SVG 备用画布的边宽。默认全图细线显示；聚焦、当前关联与选中关系继续使用原有颜色突出，同时保持较细线宽。最终 Sigma 普通边宽为 `.8 + normalizedWeight × .4`，活动边 `1.4`、选中边 `1.6`，通过公开设置 `minEdgeThickness: 1` 与 `antiAliasingFeather: .4` 保持细线连续。SVG 普通／活动／选中分别为 `.5/.75/.95`，并移除会覆盖动态属性的固定边宽 CSS。最终尺寸与视觉结果按本轮报告记录，不仅凭源属性推断实际观感。

早期子像素线宽候选虽通过一般裁切检查，但 Sigma 视觉出现虚点，未计为连续线验收通过。其材料仅保留于诊断目录 `attempt-before-feather` 和 `attempt-before-width-floor`；最终组件使用上述修后设置重新运行，摘要已记录精确源码哈希及截图哈希。

不修改节点大小、圆形初始布局、节点／边数量、语义方向、谓词、依据、搜索、逐层探索、正文或来源协议。视觉变化不增加任何概念、实体或关系，不制造共现边或桥接边，也不改变知识快照与业务记录。

本轮没有增加模型调用、知识重编或持久写入。所有知识空间仍共享一份 Wiki 网页与编译引擎，各空间只持有各自资料和快照。变更限定在本插件自有渲染层，未修改 Harness 源码、构建物、内置插件、依赖或原生组件；只使用官方公开机制。

## 最终归档来源隔离

最终包从已验证 0.23.0 归档（SHA-256 `50c2211897f0f714d7e8018f0bc105a45043286d19805511bc300d38806316f3`）提取到独立 staging，仅叠加本轮 `WikiNetwork.tsx`、`styles.css` 及版本／说明元数据后构建打包。共享工作区中的并行工作流变更没有纳入本轮；没有覆盖、回退或打包这些并行修改。[来源基线](../artifacts/wiki-thin-lines-validation/source-baseline.json) 与归档审核记录该隔离方式。

与基线相比，正式归档的生产 `src/`、server／client 构建物和共享编译引擎字节完全相同，归档变化共九个文件，限于两个网页源文件、编译网页、版本与说明元数据。审核以该 staging 及最终包为对应关系，不以并行工作区后续版本或构建物冒充本轮发布源。

## 验证范围区分

本轮按精确源码哈希记录 Sigma 的公开最小厚度、抗锯齿与边宽设置，以及 SVG 边宽和 CSS 覆盖移除；组件视觉确认普通和高亮线连续且较上一版更细。双渲染器原有圆形、真实拓扑、强拖动与适配行为通过。相关单元、严格 Wiki Web 类型检查、构建、源码组件及实际页面分别记录证据。源码组件不冒充最终归档浏览器运行；实际截图不代替归档哈希和数据完整性核对。

本次为局部显示调整，不重跑上一版完整员工 78 项与语言 9 项。该取舍不取消官方干净环境的归档安装、核心使用、卸载、重装及完全清理验收。

## 官方归档生命周期

执行前独立核对最终归档 SHA-256 与大小一致。共享工作区的 `package.json` 已由并行任务推进为 0.24.0，因此生命周期不从该混合工作区读取版本；原版 `tests/plugin-lifecycle.mjs`、`integration/web-auth.mjs` 和 `scripts/start-harness.mjs` 三个必要测试支持文件原样复制到 0.23.1 staging，逐字核对，测试逻辑不变。新增支持文件不进入已经冻结的归档，也不回写共享工作区。随后从 staging 执行相同官方生命周期测试，归档、官方 manifest 与报告均指向仓库绝对路径：

```sh
WORKFORCE_RELEASE_ROOT="$PWD"
cd "$WORKFORCE_RELEASE_ROOT/.local/wiki-thin-lines-package-g_gey4n9"
DSH_INSTALLATION_MANIFEST="$WORKFORCE_RELEASE_ROOT/.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json" \
WORKFORCE_LIFECYCLE_UI=0 \
WORKFORCE_LIFECYCLE_REPORT_DIR="$WORKFORCE_RELEASE_ROOT/artifacts/lifecycle-0.23.1" \
node tests/plugin-lifecycle.mjs "$WORKFORCE_RELEASE_ROOT/artifacts/dsh-plugin-composable-workforce-0.23.1.tgz"
```

最终归档在完整官方 DSH `0.2.1-alpha.2`、独立临时 profile 与随机端口完成 14/14 项安装、核心功能、普通卸载、原生宿主、保留数据重装和完全 purge 流程。报告中的 `tarballSha256` 与最终归档一致。普通卸载不改知识与业务状态，重装后模板、员工、工作流、任务、交付版本和验收历史保持一致，无重复实例与重放；完全清理移除本插件专属状态、知识和配置，同时保留用户成果与共享凭据夹具。

39 项运行时 peers 精确版本匹配并解析到完整官方安装。官方安装与依赖共 28,779 个程序文件，前后摘要同为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`，没有改写宿主程序文件。正常退出后独立核对临时目录已删除、随机端口 `53878` 拒绝连接、对应临时路径进程为零。

[生命周期摘要](../artifacts/wiki-thin-lines-validation/lifecycle-summary.json) 同时记录最终归档、实际 staging 执行根及三个原样测试支持文件 SHA-256。隔离验收未访问用户 `3081` 服务或生产数据，没有创建工作树、修改共享工作区的 0.24.0 元数据，或重新打包冻结归档。

## 本地正式安装与实际细线效果

用户本地通过官方 CLI 更新到 0.23.1，安装报告绑定最终归档 SHA-256 `5f259ad82a112b281b35decd9469dd2b761b88f9df3c345807036fc55c968efe`。已安装 server、client 和 Wiki 网页三个构建物与本轮隔离 staging／正式归档逐字节一致，没有混入共享工作区的并行 0.24.0 修改。

39 项 peers 通过官方公开 `createRuntimeResolution` 和 `PluginPackages.packageOf`，以当前已安装 profile 和完整官方安装为输入，在独立验证进程中做只读解析复现。精确版本全部匹配，作用域均为 `installation`，物理路径位于完整官方安装；复现前后 profile 文件相同。该检查不是对运行服务模块内存的内省，也没有为适配验证结果改动宿主或仓库祖先依赖。

更新前后状态文件字节与 API 状态相同，revision 保持 115，状态文件 SHA-256 为 `61e3093f180a5cc823ddb08b35abc24ae26ce11d328e9f6c9b8cf4848b966648`。461 个知识文件哈希、profile 配置和两个旧项目对话的工作流视图均未改变。数据保留报告中的 `mutatingLiveRequests` 为零，没有为核对界面推进、验收、改选或重放任务。

实际认知记忆界面仍为 41 个概念、48 条语义关系；普通关系线明显细于上一版，并保持连续可读，节点、关系与圆形分布保留。截图核对只进行选择与阅读，没有改写知识或业务状态。[更新前的选中概念界面](../artifacts/wiki-thin-lines-validation/live/before.png)、[更新后的细线全图](../artifacts/wiki-thin-lines-validation/live/overview.png) 分别记录实际状态，不作为相同选择状态的像素量测。

本轮没有声明重新完成员工 78 项、语言 9 项或完整源码 669 项；这些完整结果仍按 0.23.0 记录。本版新证据限定为 20 项图谱单元、严格 Wiki Web 类型检查、隔离构建与包审核、同源双渲染器专项、绑定最终归档的 14 项生命周期，以及正式本地安装／数据保留与实际截图。
