# 0.25.5 项目 Wiki 状态与真实资料整理验收

日期：2026-10-25。目标版本：0.25.5。

**真实团队整理和最终归档验收全部完成。** 类型／构建、源码组件 15 项、官方原生 30 项、语言 3 项、生命周期 14 项、本地安装及实际页面检查通过。真实知识整理与插件版本安装分别比较，不把授权新增知识或已保留的并发选择说成全数据未变，不使用前版通过结果替代本轮验收。

## 检查状态

| 项目 | 当前状态 |
| --- | --- |
| 最终 0.25.5 插件归档、SHA-256、大小与文件审计 | [最终包](../artifacts/dsh-plugin-composable-workforce-0.25.5.tgz)；`d0fa1a1f55fd874836774ca22bb1cbca1a3f394e159245e6eed7e4bf40801c3f`；1,066,527 字节、362 文件；[归档审核](../artifacts/project-wiki-status-validation/archive.json) |
| 类型／构建及生产变更范围 | 类型／构建通过；仅 3 个 UI 生产源文件变化，server／Wiki 不变；[变更范围](../artifacts/project-wiki-status-validation/change-scope.json) |
| 正式原生、语言与生命周期 | 最终包原生 30、语言 3、生命周期 14 通过；[验收摘要](../artifacts/project-wiki-status-validation/validation-summary.json)、[原生报告](../artifacts/project-wiki-status-validation/native/report.json)、[生命周期](../artifacts/lifecycle-0.25.5/report.json) |
| 真实团队现有资料整理 | 4 份真实仓库文档录入，合计 6 条来源，`ready`／v1；[上传记录](../artifacts/project-wiki-status-validation/live/upload.json)、[资料与快照](../artifacts/project-wiki-status-validation/live/library-latest.json) |
| 编纂结果、节点／关系及模型 trace | 9 个 B 条目、30 节点＝25 概念＋5 实体、26 关系、46 个阅读页；模型调用 2 次；[Wiki 结果](../artifacts/project-wiki-status-validation/live/wiki.json) |
| 本地安装与整理后数据保留 | 通过；[安装](../artifacts/project-wiki-status-validation/live/installation.json)、[整理后安装基线比较](../artifacts/project-wiki-status-validation/live/data-preservation.json) |
| 实际项目界面 | 真实 25 概念＋5 实体／26 关系、文章可打开；12 步骤圆三态／双环核对通过；[实拍报告](../artifacts/project-wiki-status-validation/live/ui-checks.json) |
| 最终汇总 | [verification.json](../artifacts/project-wiki-status-validation/verification.json) |

全部正式结果须绑定本轮同一归档，不使用之前版本的检查计数替代。官方扩展边界、安装与清理要求见 [ADR-001](../docs/decisions/001-official-plugin-boundary.md)、[安装说明](README.md) 与 [许可说明](THIRD_PARTY_NOTICES.md)。

## 初始无图原因与空间边界

项目 `547385aa-7158-4b42-bccc-6dabfb6d9aec`（`A_ComposableDigitalWorker`）的真实工作流共享团队是 `1c3c2ca6-9077-40d4-b473-8d69a1b0a132`。只读调查确认：资料管理员开启、唯一根负责人为产品负责人、模型配置为继承，三类自动归档未另存配置，因而使用默认全部开启。

真实共享库初始 A 层只有两条用户确认的项目记忆：**用户确认的数字员工插件需求**、**项目员工配置入口的职责**，正文共 283 字符。来源已经归档，但没有 `snapshot.json` 或 B／C 知识发布，因此页面显示 `pending`／“资料已收录，等待资料员整理”。这不是资料员被关闭，也不是已有图谱被删除；模型有效性要到实际编纂时解析，不能仅凭继承配置宣称模型调用已成功。

同一项目的演示团队 `demo-preview-team-cc20b862db4910c08dd2c9cb` 拥有独立空间，初始 A 层 8 条来源＝6 份明确标记的手工演示资料＋2 条既有项目记忆，已有人工编排快照 v1，29 个知识节点、25 条关系，`compilationTrace.modelCalls=0`。29 是总节点数，不是 29 个概念另加实体。

演示团队的三类自动归档配置均为 `false`，员工 projectMemory／employeeMemory 也关闭，属于演示隔离设置，保留原样。演示资料和模拟验收不提升为真实项目事实或用户确认。本轮资料录入只针对真实团队，不从员工私库复制、不新增演示资料、不改演示来源、图谱或自动开关。

## 本次真实资料录入与整理

通过插件使用官方 host 扩展机制注册的认证路由 `POST /digital-workers/api/knowledge/upload`，向真实共享库录入以下现有仓库文档，合计约 32KB：

- `docs/decisions/001-official-plugin-boundary.md`
- `docs/architecture/incremental-knowledge.md`
- `docs/architecture/project-delivery-review.md`
- `docs/architecture/shared-llm-wiki.md`

目标为 `scope=project`、`library=team`、上述项目与真实团队，授权员工 `20d54973-033d-4fa6-8547-64ed1742ee4d`。4 份来源加上初始两条记忆，录入后共 6 条来源。接口返回 `202`／`compiling`；一次缺少 Origin 的请求先收到 `400` 且未写入，之后符合认证／CSRF 要求的请求成功。该路由属于本插件提供的 API，不称作 Harness 内置 API。

早期只读状态查询为 `compiling`，未再次发送上传或重试。最终 [资料快照](../artifacts/project-wiki-status-validation/live/library-latest.json) 状态为 `ready`、版本 v1：6 条来源、9 个 B 条目、30 个知识节点，其中 25 个概念和 5 个实体，26 条语义关系；[Wiki 投影](../artifacts/project-wiki-status-validation/live/wiki.json) 有 46 个阅读页。来源、重组文章和概览保留为阅读页面，图中节点仅为概念／实体。

本次 `strict-incremental-v1` trace 明确记录新增／更新来源为全部 6 条，删除来源为空，真实模型调用 2 次，模型为 `deepseek-official/deepseek-flash`，推理强度 `high`。提供方报告的两次合计用量为输入 25,674 tokens、输出 60,806 tokens、总计 87,120 tokens，缓存读取 640、缓存写入 0。只记录实际报告用量，不据此推断费用。模型编纂得到的是带证据的候选知识，不是自动用户确认；未补造任何演示来源或真实验收。

## 本次整理的数据变化

[整理保留报告](../artifacts/project-wiki-status-validation/live/organization-preservation.json) 记录知识文件从 `548→606`：只有真实团队库的 A 来源索引和“专业知识”分类索引两个既有文件更新，新增 58 个原始资料、来源版本、B／C 快照和 Wiki 投影文件，没有删除文件。全部旧 A 原文和版本、演示及其他知识库保持不变。这里存在一次成功的明确上传请求、4 份文件录入和实际知识发布，不能笼统说“没有数据写入”。

同期状态 revision `129→130`，观察到演示实例 `demo-preview-instance-cc20b862db4910c08dd2c9cb` 的并发选择：`technical-review→defect-convergence`，实例版本 `6→7`，`updatedAt` 变为 `2026-10-25T13:17:17.833Z`。除这三个实例字段及全局 revision 外，其他业务记录保留；任务执行方没有发出工作流状态写入请求。保留该选择，不回滚，也不将其归因为知识整理。后续安装比较以整理完成后的 revision `130`、606 个知识文件作为独立基线。

## 以后何时自动制作图谱

资料管理员随项目团队生效，使用唯一根负责人的当前模型；员工影子资料员按授权范围处理私库。共享库只接团队说明、项目范围的明确记忆、任务目标与有效已验收成果等允许来源，不自动扫描整个项目文件夹，也不自动复制员工私库或整段会话。

严格增量流程分开处理“归档来源”和“调用模型编纂”。启动只归档现有 A 来源并建立基线，不调用模型；打开项目 Wiki 不触发模型编纂。项目 Wiki 的读取可构建／缓存已发布快照的图形投影，这是本地投影，不等于重新让模型整理原始资料。

自动编纂按有效事件触发，而非每个 turn、固定 session 或计时轮询触发：

- 明确上传／更新专业资料或已确认来源，来源版本或内容实际变化。
- 任务或工作流达到可归档的稳定业务阶段，例如验收、阻塞、取消或需重新核验；执行中的短暂状态不反复作为新的阶段。
- 员工启动授权任务时发现有尚未编纂的明确资料，可为其可见空间补一次整理。
- 用户明确点击重试／知识重组，可通过同一上传路由发送 `files: []`、`retry: true`。

三类自动开关控制任务档案、复盘经验、工作约束的新自动归档；关闭后保留已存在证据与知识，开关变更本身不调模型。显式资料授权不被自动开关扩大，资料管理员总开关关闭时停止该库长期读取和写入。来源、负责人模型或团队状态变化会取消过时的在途编纂。

失败会保留上一有效快照和来源，普通后续对话不会每轮循环重试；需要明确重试或新的有效来源／业务阶段事件。相同来源指纹已有有效知识时，严格增量重试不会强制全量重做。通常需要 Wiki 分析与知识生成两个模型阶段，必要时增加证据对齐修正；实际调用数和用量只以完成后的 trace 为准。

## 正式版本检查与生命周期

正式检查绑定上述最终归档。源码组件 15 项通过，受控 transport／Wiki handshake 夹具的浏览器错误为空；被测文件与最终归档源文件哈希对应，但不把源码夹具称为正式归档执行。最终包在完整官方宿主中完成原生 30 项与语言 3 项，页面错误为空，原生报告 SHA-256 为 `f5ad9982a4e46c7973bf736547154e0a0d248e949c354e73723974dab29069d7`。

本轮同时验证详情节点与真正顶部步骤条的灰／白／蓝状态、双圈与黑色全局序号一致；只读查看已完成或待做步骤不改变实际当前步骤的蓝色状态。保留 16 组主题／语言／宽度、48 个顶部布局案例和 5 个详情滚动／缩放案例；宿主锚点、文字底部及详情中心回归通过，圆顶端点误差仍在 `1/32px` 容差内。未重跑完整源代码套件或旧 helper 单元，不借用旧计数。

[生产源代码差分](../artifacts/project-wiki-status-validation/change-scope.json) 确认 0.25.4→0.25.5 只改变 `src/ui/ConversationWorkflowDetails.tsx`、`src/ui/conversation-workflow-details.css`、`src/ui/conversation-workflow.css`，用于详情节点状态和已有顶部样式的一致性。server 和 Wiki 实现未变；本次真实资料整理调用的是既有知识入口，不是新增或替换资料员引擎。

使用完整官方发行版与独立临时 profile 执行的生命周期命令为：

```sh
DSH_INSTALLATION_MANIFEST="$PWD/.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json" \
WORKFORCE_LIFECYCLE_UI=0 \
WORKFORCE_LIFECYCLE_REPORT_DIR="$PWD/artifacts/lifecycle-0.25.5" \
node tests/plugin-lifecycle.mjs artifacts/dsh-plugin-composable-workforce-0.25.5.tgz
```

最终包生命周期 14/14 通过，覆盖官方安装、核心能力、普通卸载、原生功能、保留数据重装和完全 purge。39 项 runtime peers 均为精确版本的官方实体安装；28,779 个宿主程序文件执行前后摘要同为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`，用户成果和共享凭据夹具保留。脚本自然退出码为零，独立临时目录删除、端口 `59256` 拒绝连接、对应进程为零；详见 [清理核对](../artifacts/lifecycle-0.25.5/cleanup-audit.json)。正式原生临时端口 `59180` 和目录也已清理。隔离验证没有修改宿主或创建工作树，未将用户 `3081` 用作隔离验收环境。

## 本地安装与整理后保留核对

本地在真实编纂完成后通过官方 CLI 停止／安装／启动最终 0.25.5，相关进程自然退出码为零。[安装报告](../artifacts/project-wiki-status-validation/live/installation.json) 确认 362 个安装文件与上述归档字节一致，39 项 peers 为精确版本的官方安装作用域。依赖核对是在独立只读进程以实际 profile 复现官方公开 runtime resolver，解析期间 profile 文件不变；不是对运行服务模块堆内存的内省。

[数据保留报告](../artifacts/project-wiki-status-validation/live/data-preservation.json) 的基线是**授权整理完成且保留并发选择后的 revision 130、606 个知识文件**。安装和后续只读查看期间，状态字节及 API 完全一致，606 个知识文件哈希、profile 配置、全部 3 个会话视图均不变，真实快照 v1 保留，新增业务状态写入为零。该结果只说明整理后的安装基线保持，不回写成整理前的 548 个文件未变化，也不掩盖实际上传和模型发布。

## 实际页面与阅读效果

[实际 CUA 报告](../artifacts/project-wiki-status-validation/live/ui-checks.json) 只读查看了演示工作流的 12 个编号圆：1–3 为已完成白色，4–8 及 10–12 为待做灰色，真正当前第 9 步为原生业务蓝色。DOM 核对每个圆的等宽高、`50%` 外圈与内圈、双环伪元素及序号；查看时没有切换工作流进度或验收，`workflowActions=0`。演示状态仅作为界面状态示例，不转换为真实项目验收。

![详情步骤圆三态与双环](../artifacts/project-wiki-status-validation/live/workflow-status-nodes.png)

真实项目 Wiki 实拍显示快照 v1、25 个概念、5 个实体和 26 条语义关系。打开了真实重组文章“严格来源增量、失效传播与冲突治理”，正文和来源行入口可访问；不是用演示图替代真实编纂结果。最终浏览器保留原真实会话的项目知识库供直接查看。

![真实项目知识图谱](../artifacts/project-wiki-status-validation/live/project-wiki-overview.png)

![真实知识文章与来源入口](../artifacts/project-wiki-status-validation/live/project-wiki-article.png)

[最终验证汇总](../artifacts/project-wiki-status-validation/verification.json) 绑定唯一最终归档、各独立测试及本地报告，校验和再次通过。本轮成功接受的知识写入为 1 个请求、4 份真实文档并发布候选知识；没有本任务发出的工作流状态写入，没有修改宿主或复制员工私库，演示标记和隔离开关保持原样。
