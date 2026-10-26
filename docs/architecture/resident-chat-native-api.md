> plugin.4 已按用户要求收简顶部为员工姓名列表，不再展示轻咨询/执行任务选择。本文保留 plugin.3 的原生 API 验证与测量历史；当前入口见 [Chat 工作区](chat-workspace.md)。

# Chat 常驻员工与轻咨询：官方接口依据

验证宿主：官方 DeepSeek Harness `0.2.1-rc.3`。插件版本：`0.2.1`。验证对象为本仓库精确依赖的官方 SDK；下列机制没有修改宿主源码、构建物、安装目录或原生请求。

## 接入方式

用户显式为一个 Chat 对话选择员工及“轻咨询”或“执行任务”。未选择时仍是 DSH 原生助手；以前 `@` 过某位员工不会创建常驻关系。常驻轮次继续使用原生 Agent、Session、历史、附件、模型选项及流式输出。单次 `@` 保留独立工作单语义。

轻咨询只提供当前员工的简短职责与回答约束，不自动启动工程工作单所需的必备 Skill、知识准备、工具执行或交付流程。模型和推理强度继续遵循当前明确选择及原生规则，不按问题文本推断并偷偷更换。

每轮能力约束使用三个公开机制，缺一不可：

1. `agent.ctx.tools.restrict({ allow: [] })` 隐藏继承的工具，并让官方 Skill 插件停止本轮目录发现。
2. 官方 `system-prompt/assemble` waterfall 返回 `tools: []`，使装配结果及记录的原生请求头没有工具定义。该入口也处理 PTC `run_code` 及 Agent 自身层工具不受 restriction 约束的例外。
3. `agent.ctx.tools.guard()` 单调拒绝任何实际调用。即使模型从历史中记得工具名或发送未声明调用，也不能执行。

以上注册均保存官方返回的精确 disposer，在轮次结束、失败、取消或插件卸载时解除。不调用全局 restriction，不改共享 preset，不注册只用于咨询的员工执行工具。首次装配中准备 lease 后，通过公开装配入口重新装配一次，让当前轮次的工具表与目录可见性保持一致；不是改写已冻结的 LLM 请求。

## 官方主依据

以下路径均相对于 `node_modules/@deepseek-ai/`，在本仓库解析到已验证的原版 SDK：

| 接入点 | 官方定义与实现 | 契约 |
| --- | --- | --- |
| 每轮消息准入 | `dsh-agent/lib/types/runtime-types.d.ts:92`、`:304`；`dsh-agent-loop/lib/index.js:902` | `agent/pre-step` 只能拒绝或替换准入消息，没有 `tools`、`toolChoice` 字段。宿主先装配，再触发该事件。 |
| 工具装配 | `dsh-system-prompt/lib/types/index.d.ts:18`、`:113`；`dsh-system-prompt/lib/index.js:398` | `PromptAssembly.tools` 是公开 waterfall 的权威返回值；完整系统提示 section 由宿主恢复，不能通过此接口冒充替换。 |
| 可撤销工具限制 | `dsh-tools/lib/types/index.d.ts:505`、`:639`；`dsh-tools/lib/index.js:2991` | 只能在 scope 中使用，限制继承的工具；自身 scope 注册的工具及 PTC transport 是明确例外。返回精确 disposer。 |
| 执行兜底 | `dsh-tools/lib/types/index.d.ts:647`；`dsh-tools/lib/index.js:3337` | `tools.guard` 位于可扩展 pre-execute 后，拒绝不能被其他监听器覆盖。 |
| 原生技能目录 | `dsh-tool-skill/lib/index.js:931` | 仅当当前 Agent 仍可见该插件的 `skill` 工具时发现技能；不可见时使用空目录。首次空目录不注入消息，旧目录存在时发布原生空目录更新。 |
| 用户显式技能 | `dsh-tool-skill/lib/index.js:896` | 用户明确发起的技能调用仍由宿主独立解析。咨询模式不会偷偷丢弃用户提交的显式 Skill 内容。 |
| 原生请求不可改写 | `dsh-llm/lib/types/index.d.ts:37` | `llm/stream` 收到的 AgentLoop 请求被冻结，监听器只读，不能删除工具、历史或推理内容来制造低开销数据。 |
| 模型设置 | `dsh-llm/lib/types/call-config.d.ts:11` | 公开调用配置只有 provider/model、推理与采样设置；没有工具白名单或 toolChoice。 |
| preset 生命周期 | `dsh-agent-preset-registry/lib/types/index.d.ts:116` | `recompose` 只允许 blank Agent，`select` 在首轮前切换；不能为既有历史对话按轮次换 preset。 |

## 离线真实 Agent 验证

可运行：

```sh
node tests/native-consultation-api-probe.mjs
```

脚本只创建临时内存 Context、原生 Agent/Session、合成工具和技能；Adapter 本地返回固定流，不访问网络、真实用户 Session、凭据或付费模型。从源码仓库运行，结果写入忽略的 `artifacts/resident-chat/native-api/results.json`；安装包不含测试夹具。

已验证：

- 首轮轻咨询：当前工具定义为零，原生技能目录未注入；系统身份和必需策略上下文仍在。
- 同一会话连续咨询、切执行、再切咨询：同一个 Session，历史和原生 assistant-stream 连续，其他会话不受影响。
- 切执行后 disposer 恢复工具表与原生目录；没有新建或伪造 Session。
- PTC 模式下仅 restriction 仍保留 `run_code`；加入公开装配结果和 guard 后，当前工具定义归零，原生请求头同样记录为空。
- 故意让离线模型发出历史 `run_code` 调用，guard 拒绝，执行次数为零，下一步原生回答流正常完成。

合成夹具中的工具表为 `453` 字节，首轮轻咨询为 `2` 字节（空数组的 JSON 表示）；PTC transport 为 `1887` 字节，咨询时同样归零。小夹具首轮执行请求 JSON 为 `3589` 字节，咨询为 `1701` 字节。这些是 UTF-8 序列化测量，包含用于诊断的结构字段，不是模型 tokenizer 计量，也不能当成真实产品的固定 token 数或缓存命中率。

## 完整软件岗位的离线对照

`npx tsx --test tests/resident-conversation-runtime.test.ts` 将真实 `WorkforceRuntime`、生产软件岗位种子、随包完整 Skills 与官方文件/技能插件组合，在独立临时 Chat 工作区内截取模型入口请求。`complete-seed-comparison.json` 只保留字节统计、上下文摘要哈希、工具名和调用次数，不包含用户资料。

| 相同问题“你是谁”，相同产品负责人、显式 high 推理设置 | 轻咨询 | 执行任务 |
| --- | ---: | ---: |
| 当前工具定义数量 | 0 | 7 |
| 工具定义 JSON 字节 | 2 | 3,779 |
| 模型消息内容序列化字节 | 2,649 | 13,844 |
| 员工上下文字节 | 2,115 | 7,917 |
| 实际发送的完整原生 Skill 目录消息 | 0 | 1 |
| 自动加载完整 Skill 次数 | 0 | 1 |
| 知识准备次数 | 0 | 1 |

对照 JSON 的 `operations.skillDiscoveryCalls` 是本机 Skill provider 的发现调用次数，不是发送给模型的目录数。执行模式出现两次本机发现：一次来自岗位必备 Skill 的 `registry.get()`，另一次来自官方 `dsh-tool-skill` 的 `registry.snapshot()`；它们最终只发送一份完整目录，测试通过 `sentCatalogMessages === 1` 断言。发现调用本身没有模型请求；完整 Skill 正文只加载一次。

这个原生测试环境只加载官方文件和 Skill 工具，不是完整 Desktop 的 32 项原生工具快照；表格是可复现的构成对比，不能把字节下降直接转换为真实模型 token 节约率。相同测试另验证连续咨询、切执行、换员工、退出常驻、另一对话隔离及原生流的连续性。员工显式指定模型和推理强度时，两模式都遵循该配置；员工未指定推理强度时遵循相应模型默认，不能把其他模型的枚举强加过来。

## 历史、缓存与边界

切换模式不会删除既有目录、工具结果、历史回答或必要推理内容。若之前已经执行过任务，原生 Skill 插件会追加“目录已变为空”的更新；恢复执行会追加完整目录更新。因而切咨询后的某一轮总输入可能仍然上涨，不能承诺马上消除旧的 14K 或达到 100% 命中。首轮即选择轻咨询的节省更明确。

稳定职责、稳定工具表和不变历史前缀有利于服务端前缀缓存；切员工、切模式、改变工具定义、知识版本、模型或 provider 都可能改变前缀。缓存是 provider 的服务端能力，不等同于本机对象或内存常驻；命中数量以真实 provider usage 为准。频繁切模式会累积原生变更通知并可能降低缓存复用，界面应让用户理解“轻咨询”和“执行任务”的差别。

原生系统身份、沙箱和审批等必需策略仍然保留。轻咨询不能承诺零 token，也不会通过删除安全上下文、篡改历史、手工缓存一次答案或降低推理强度来美化测量。需要工程工具、检索或完整知识处理时，用户显式切为执行任务。
