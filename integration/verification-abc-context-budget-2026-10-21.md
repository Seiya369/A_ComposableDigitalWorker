# ABC 激活与上下文额度开发包验证

日期：2026-10-21（Asia/Shanghai）。本记录绑定以下开发归档；未发布到 npm，未安装到用户当前 profile。历史归档与验证记录保留。

## 归档与兼容目标

- [开发归档](../artifacts/knowledge-context-budget-2026-10-21/package/dsh-plugin-composable-workforce-0.4.0.tgz)：`dsh-plugin-composable-workforce@0.4.0`，224924 字节，95 个文件。
- SHA-256：`3a3cba8a1fef2cf07fa60ea68364d9c9d347cce9871d2389fc4c3dc90011235b`。
- [SHA256SUMS](../artifacts/knowledge-context-budget-2026-10-21/package/SHA256SUMS)、[归档检查](../artifacts/knowledge-context-budget-2026-10-21/package/archive-check.json)、[完整测试日志](../artifacts/knowledge-context-budget-2026-10-21/package/tests.log)。
- 官方目标：`@deepseek-ai/dsh@0.2.1-alpha.2`；Node.js `^22.19.0 || >=24`，本次使用 v24.21.0。
- 公开运行时 peer：working-directory、agent-preset-registry、token-meter、compaction，均为官方 `0.2.1-alpha.2`。兼容声明不外推到其他发行版。
- npm pack 白名单排除宿主源码补丁、宿主构建物、node_modules、本机数据、凭据、测试夹具、artifacts 与 source map。11 项保存文件与归档内容逐字节一致，包含插件 Host/Client 构建、知识库说明、包声明、变更说明、MIT 许可、第三方声明及安装清理脚本。

## 最终激活与额度

C 按当前任务选择并在一次运行中复用；需要详细知识时读 B。A 读取必须传入以下 reason 之一：逐字引用 quote、精确数值/命令/接口 exact-detail、版本或状态冲突 conflict、核验 verify、必要证据缺失 missing-evidence、来源对照 source-comparison、没有可用 Wiki no-wiki。已指定来源的核验可直接读取 A，无需制造一次 B 调用。

| 层级 | 默认额度 |
| --- | ---: |
| C 目标 / 硬上限 | 2000 / 3000 |
| B 单次 / 当前累计 | 3000 / 8000 |
| A 单次 / 当前累计 | 2000 / 4000 |
| ABC 共享总上限 | 12000 |

额度包含序列化正文、引用、定位、导航及分页元数据，当前使用 UTF-8 字节保守计数，并非对应模型的精确 tokenizer。团队与员工库共享额度。总额度同时受模型窗口、实际输出预留、系统提示、工具定义、待追加消息及历史约束；不能把三个分层上限相加作为允许输入量。

A 保持版本化原文，B 抽取相关原段；超限时分页或收拢旧知识结果，原始 ABC 文件保持完整。引用保留库、ID、版本、行号，部分行附一基 UTF-16 列范围、末列不含。A/B 支持 cursor，B 大引用列表支持 citationOffset；索引搜索需要细化 query，不返回指向虚构文档的分页入口。

## 代码与官方上下文验证

- `npm test`：264/264 通过；`npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 测试覆盖 A reason 在读取前校验、版本及行列范围、长中文与长单行、导航与引用分页、重复内容、C 固定占额、B/A 单次及累计限额、总限额、明确的预算不足错误。
- 真实官方 Session 验证：只对本插件知识工具结果，通过公开 `agent/pre-step`、`compaction/prune`、`tool/result` 与 `surfaceOp:replace` 收拢活跃内容。原始事件保留，消息身份与调用关联不变，官方重放可复现；其他工具和用户文本不被当作知识包改写。
- 请求检查计入完整系统提示、工具 schema、历史和首步待追加消息；模型 `maxTokens` 与输出预留一致。非知识历史超限时明确失败，不静默裁切后继续。
- 关闭知识库后的读取限制、员工权限、来源撤回及子任务知识依赖检查继续生效。

## 三档任务验证与调整

合成语料覆盖 14 类任务：主题选择、精确命令、否定和例外、现行/废止冲突、候选证据、跨来源范围、原句引用、长中文、API 代码、长单行、原始资料兜底、多轮累计、巨大引用元数据、完整政策矩阵。固定 gold 为 65 项证据，包含准确版本与原文定位。

[最终检索报告](../artifacts/knowledge-context-budget-2026-10-21/final/retrieval-report.md)、[机器明细及源码绑定](../artifacts/knowledge-context-budget-2026-10-21/final/retrieval-report.json)。

| 档位 | C / B单次 / A单次 / 总额 | 最终活跃及正确引用证据 | 完整证据任务 | 预算溢出 |
| --- | --- | ---: | ---: | ---: |
| compact | 800 / 1200 / 800 / 6200 | 29/65 | 6/14 | 0 |
| balanced | 2000 / 3000 / 2000 / 12000 | 65/65 | 14/14 | 0 |
| expanded | 3000 / 4000 / 3000 / 18000 | 65/65 | 14/14 | 0 |

紧凑档发生 8 次最小引用/证据无法容纳错误，均显式报告；没有超限后继续。12K 和 18K 均无此错误。后者少一次读取，没有增加关键证据覆盖。

三个 fresh-context 智能体分别在各档逐题独立回答，共 42 份初轮答案；只见任务及已选择知识包，不见 gold。使用当前 Codex 默认模型，语义评分由评审智能体按固定 rubric 执行，引用由另一智能体审计。初轮主要任务完成数为 8/14、14/14、14/14；没有发现编造或把候选结论升格为确定事实。

根据答题中发现的遗漏补充了引用格式及“上下文缺资料 / 判断需新试验”的区别，没有直接放大默认额度。其后修正元数据身份及分页保留，重建 42 个输入并核对源码哈希；一个紧凑档任务在场证据改变，另做独立重答。原始答案和原始评分均保留。另对 12K 两题定向重答，长单行列号补齐；权限题主问正确，但一个非关键附加事实仍遗漏。39 份支持性复核的原答案加 3 份定向重答构成兼容集合，其主要任务完成数仍为 8/14、14/14、14/14，有效引文 58/58。此集合不冒充全部 42 题按同一提示重新运行。

详见[回答质量报告](../artifacts/knowledge-context-budget-2026-10-21/llm/answer-quality-report.md)与[源码、输入、rubric、评分及复核记录](../artifacts/knowledge-context-budget-2026-10-21/llm/answer-quality-report.json)。因此选择 12K 为当前默认候选，保留可配置额度、分页和阶段交接。

## 归档的官方安装生命周期

官方 pnpm 对仓库中的长归档路径产生 ENAMETOOLONG。未修改宿主或安装器，改用逐字节一致且 SHA-256 相同的短路径副本执行测试；保留[首次失败日志](../artifacts/knowledge-context-budget-2026-10-21/package/lifecycle-long-path-failure.log)与[安装输入说明](../artifacts/knowledge-context-budget-2026-10-21/package/lifecycle-install-input.json)。

```sh
WORKFORCE_LIFECYCLE_REPORT_DIR=artifacts/knowledge-context-budget-2026-10-21/package/lifecycle node tests/plugin-lifecycle.mjs /tmp/cw-abc-3a3cba8a.tgz
```

独立临时 DSH_HOME、web profile 与随机端口下，通过官方 CLI 安装、鉴权 API、核心团队/任务/资料管理员操作、普通卸载、原生宿主重启、重装且数据逐字节保留、完整清理和宿主再次启动。用户交付成果、原生共享凭据及其他数据按归属保留。四个运行时 peer 的官方版本均核对一致。没有发起外部模型请求。

[生命周期机器记录](../artifacts/knowledge-context-budget-2026-10-21/package/lifecycle/report.json)绑定相同归档 SHA-256，`passed=true`。官方程序与依赖共 28401 个文件，前后总 SHA-256 均为：

```text
401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003
```

## 验证范围

已验证预算选择器、实际 Session 活跃结果收拢、请求额度守卫及归档生命周期。合成题采用预定检索路线、单次答题和当前 Codex 默认模型；尚未验证真实项目分布、真实 DSH 团队负责人模型的自主 A/B 激活和长期 B/C 编纂质量。不能由 14 题的结果推断任意模型或任务的最优额度，也不将本开发包标为已完成这些质量验收的正式发布。
