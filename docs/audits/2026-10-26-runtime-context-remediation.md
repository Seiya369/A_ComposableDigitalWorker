# 原生上下文、缓存、并发与知识整理：综合核查及修复

适用版本：插件 0.30.0；官方 DeepSeek Harness 0.2.1-rc.3。本文汇总对话锁定、长时间无反馈和 token 消耗调查后的分析、口径更正、修复计划与执行结果。最终归档及宿主验收见[版本验收记录](../../integration/verification-0.30.0.md)。

## 1. 现场证据与正确口径

| 证据 | 含义 |
| --- | --- |
| 问题请求：未命中输入147,862、输出1,665、缓存读取0 | 完整输入也是147,862；输出包含推理和工具调用，没有用户回答正文 |
| 同会话此前一次原生请求：未命中194、缓存读取140,160 | 完整输入140,354；长历史本身并未超过模型窗口 |
| 首次业务请求之前等待约388.62秒 | 知识准备同步等待编纂队列，业务模型尚未开始产生回答 |
| 失败后另有两次知识编纂：输入5,645、输出9,765 | 15,410 tokens未计入旧业务记录；最初知识编纂用量未完整留存，不能声称已知全部账单 |
| 旧默认maxTreeTokens=120,000来自项目初始提交 | 是插件的任务保护默认值，无官方1M上下文或压缩阈值依据 |
| 插件当前贡献：岗位等6,004字符、六个工具schema2,918字符、技能目录行1,475字符 | 离线同口径约6,385 tokens增量；不是DeepSeek精确反事实账单 |

DSH的`inputTokens`仅表示未命中输入，`cacheReadTokens`和`cacheWriteTokens`分别报告。完整输入是三者之和；推理已经包含在输出中。原实现把input/output合计作为任务预算，漏记缓存字段和独立知识编纂。缓存命中不消除上下文占用，也不代表输入免费。

22项随包技能已注册进DSH原生技能服务。此前“安装但选无约增加1,120 tokens”是相对未安装时原生目录增加的技能摘要，**没有第二份插件目录**。以相同原生技能目录为基准，“无”不应增加员工业务上下文。原生目录正常计量与重复注入是两件事。

模型1M容量、原生压缩触发点和跨请求任务预算是不同概念。rc.3基本压缩策略默认取窗口80%与扣除输出预留/余量后容量的较小值；并非达到1M才开始处理。本次中止发生在插件自己的下一步骤检查，不是模型拒绝147,862长度的输入。

### 用户问题逐项结论

| 问题 | 核实结论及规则 |
| --- | --- |
| “只是问一个问题，为何输入这么多？” | 每次输入包含当时完整有效历史、系统上下文、工具及技能等；问题字数不等于请求输入。147,862不代表插件新增147,862。离线插件增量估算不能代替同一请求的服务商反事实计费。 |
| “不用插件，长会话也能更多，为何这次失败？” | 可以更多，受当前模型、输出预留及原生压缩约束。此前同会话已有140,354完整输入；本次是插件下一步120,000累计保护中止，而非达到1M，也未发现宿主进程崩溃证据。 |
| “内存中有岗位或知识就算命中吗？” | 不算。磁盘知识、Node进程内存与服务商KV缓存是三个层次。只有请求到达服务商且其usage报告cacheRead才可认定命中；同文本放在不同前缀位置、前文变化、缓存尚未建立/失效或换路由，均可能不命中。 |
| “何时卸载缓存？” | 换负责人/知识版本、选无或卸载时，退役插件当前模型表面中的相应贡献并释放工具/事件/定时器；原始审计与用户回答保留。服务商缓存由其服务管理，插件没有公开强制删除或保证TTL的能力，不能把本地退役称为远程缓存擦除。完整卸载只清理专属本地路径，原生共享数据遵循官方接口边界。 |
| “选无必须零额外token？” | 以同一原生技能目录为比较基准，不注入岗位/工作流/知识/业务工具。已安装技能的原生摘要仍可能计入请求；同时要求“技能保留在统一目录”和“与未安装时绝对零差异”不能同时成立。插件不再额外复制该目录。 |
| “每轮都整理知识吗？” | 每轮可本地留A档案，不等于每轮调用模型。业务准备不自动付费编纂；有效验收等检查点按增量调度，失败/取消仅归档。显式资料更新、确认知识及手动整理可触发编纂，用量单独可查。 |

## 2. 根因及修复顺序

| 顺序 | 根因 | 已实施的修复 |
| --- | --- | --- |
| P0 | 一个共享实例的运行状态被用来锁所有对话选择器 | busy只表示本对话；progressBusy保护共享步骤与验收。空闲对话可改选流程/无，原会话的执行身份保持冻结 |
| P0 | 员工角色按项目全局独占 | 不同原生会话拥有各自Agent、inbox、工具租约与运行记录，可以使用同一冻结角色；独立任务队列、子任务深度/并发保护继续保留 |
| P0 | 固定120,000额外限制且第一次付费后才发现不足 | maxTreeTokens默认0，即不额外限制；用户显式设置时显示清晰口径，事前检查保守输入估算，事后按真实完整用量核对 |
| P0 | 冷启动知识编纂位于业务关键路径 | 业务以available模式读取现有知识或待整理A元数据；不触发模型编纂，不等待同团队模型队列 |
| P0 | 失败/取消又被立即付费反思 | A本地归档继续保留；自动付费检查点改为有效验收。显式资料更新、上传、手动整理/重试继续可用 |
| P1 | 动态知识与稳定岗位混在一份反复提供的长提示中 | 稳定角色定义只保留一份；后续引用其内容版本；可变知识独立快照，无变化不重发 |
| P1 | 旧员工/知识贡献在None和角色切换后仍参与上下文 | 只通过官方会话表面替换退役本插件贡献，保留原生策略、用户消息、回答和不可变审计；原生压缩后按需补回当前定义 |
| P1 | 插件UTF-8估算先于原生压缩拒绝长历史 | 原生会话的完整窗口交给DSH；插件仅限制自己的ABC知识池，独立工作单仍保留原有保护 |
| P1 | 只有最终运行状态，无准备阶段反馈 | 显示准备模型、读取已有知识、载入技能、等待模型、生成与工具阶段；当前挂载对话默认每秒刷新 |
| P1 | 缓存、失败尝试和知识费用不可追溯 | 业务保留完整字段与已报告调用数；失败尝试统计已报告usage；知识每次尝试及每个发布版本分别留存trace，并在界面展示 |

## 3. 遵循原生缓存机制的格式

DeepSeek缓存没有“员工专属缓存格式”。服务端匹配已落盘的完整请求前缀，尽力复用；不保证命中。插件不添加虚构的`cache_control`、缓存TTL、请求头或缓存命中标记，也不重写原生传输器。

| 内容 | 官方接入方式 | 组织与生命周期 |
| --- | --- | --- |
| 岗位、能力偏好、协作规则、当前稳定步骤、必备技能 | `ctx.systemPrompt.context`，原生runtime-context | 内容哈希仅取稳定定义和授权作用域，不含run ID、时间、用户问题或阶段状态。完整正文在当前表面只出现一份，之后为版本引用 |
| 任务相关C知识、显式资料 | 原生`user/message`；扩展MessageSourceMap，`form:snapshot` | 单独快照、内容版本、相同版本不重复；不复制本轮用户问题。变化仅退役插件旧快照，不改岗位所在的原生策略节点 |
| 工具定义 | `ctx.tools.register`及官方Agent工具更新 | 名称、说明、schema稳定；执行闭包的run ID不进入schema。支持的路由沿用官方in-history/deferred工具更新 |
| Skill目录 | `ctx.skills.register`及原生skill工具 | 原生统一目录提供摘要；当前必备Skill按原生`skill_content`正文格式加载，其余按需加载 |
| A/B读取结果 | 当前负责人授权的原生工具结果 | 保留来源、版本、行/列范围、分页引用；ABC独立限额，不以知识字节计数替代原生窗口管理 |
| 运行阶段、模型用量、知识编纂账本 | 插件API/UI元数据 | 不放进模型提示，避免状态变化破坏缓存前缀 |

示意标记如下。这些是本插件的去重标识，**不是DeepSeek提供的特殊缓存协议**：

```text
<workforce_role_definition version="稳定内容哈希">
岗位职责、边界、工具偏好、协作规则
<skill_content ...>当前必备技能正文</skill_content>
</workforce_role_definition>

<workforce_task_context version="当前知识内容哈希">
有作用域、来源及版本的C知识包
</workforce_task_context>
```

角色不变时保留此前完整定义以及历史前缀，后续仅引用该版本。原生压缩已经移走完整定义时，下次自动补回。角色、授权或知识来源变化时，正确性和隔离优先，退役相关旧贡献可能让变化点之后的缓存需要重新建立。选择“无”不再提供当前员工定义和工具；全局技能仍由原生目录正常管理。

用户消息、已交付回答与宿主审计不是缓存垃圾，不能为了提高命中率删除。仅有磁盘记录、尚未加载的历史会话不会在卸载时被擅自激活或直接修改宿主数据库；上游持久会话删除接口仍缺失，完整清理保留项没有消失。

## 4. 真实缓存验证

使用官方rc.3 Agent、当前插件原生挂钩、CredentialService及DeepSeekAdapter，独立内存会话、合成岗位/原生技能正文/C快照及无副作用工具；未写入用户会话、未改模型设置或凭据文件。测试模型为deepseek-v4-pro、推理off、最多128输出，单独的验证配置不改变真实员工档位。

| 请求 | 未命中输入 | 缓存读取 | 输出 | 耗时 |
| --- | ---: | ---: | ---: | ---: |
| 复测首次请求（前次合成前缀已缓存） | 58 | 3,328 | 1 | 1,075ms |
| 原生续问 | 4 | 3,456 | 1 | 1,421ms |
| 第二次请求精确重放 | 4 | 3,456 | 1 | 852ms |

首次隔离验证的冷请求未命中3,386、缓存0；续问命中约96.18%，精确重放约99.88%。上表为随后复测：续问和精确重放均约99.88%，三次合计10,309 tokens，其中未命中66、缓存读取10,240、输出3；首次请求已复用前次合成前缀，不能再称冷启动。岗位/必备技能全文与C快照各一份，工具schema和原生系统前缀稳定。真实验证之后另补旧版身份退役迁移，其正确性由离线原生请求回归覆盖；最终归档与验收记录说明各证据范围。

这是缓存兼容性验证，不是任意真实任务命中率、模型质量、Max推理耗时或生产吞吐保证；当前小样本不能用来声称速度提升。默认测试不收费，真实验证必须显式设置`WF_LIVE_CACHE_VERIFY=1`；脚本限制请求数并只输出脱敏统计。

## 5. 用量、预算和知识整理规则

- 交付详情展示未命中输入、缓存读写、输出、服务商报告总量及已报告调用数。缺失字段显示未报告；不是每个调用都有报告时标为已知下限，不把它当免费。
- `maxTreeTokens: 0`为默认；正整数是用户选择的业务运行树累计计量限制，含缓存token和输出，不是金额预算。事前采用保守字节估算与输出预留；显式开启限额时实际请求最大输出也不得高于该预留，原生更小上限继续保留；默认关闭时不收窄原生最大输出。缺少完整用量时不默许继续核算。它不是服务商账单硬上限，也不覆盖独立手动/后台知识编纂。
- 步骤数、时间、委派深度和数量限制继续控制失控循环；报错分别指出具体限制，避免统一模糊提示。
- 编纂账本记录全部已结算尝试，保存在插件知识根的`compilation-attempts/`，界面/接口仅读最近50项；`compilation-traces/vN.json`绑定每个知识版本。失败、取消、部分报告和被新版本取代均如实标记，不存原始提示、资料正文、凭据或服务商错误正文。
- 业务启动不等待编纂；没有B/C时可读A索引并按权限回查。普通问题已有足够依据可直接答，不机械查库。失败/取消先归档，不自动花模型token总结；验收、显式资料或确认知识更新、手动整理按严格增量处理。
- 数据卸载随既有插件知识根清理，不触碰共享会话、凭据或成果。保留数据卸载时账本与知识一同保留。

## 6. 执行与复测方法

先写失败用例，再修复；覆盖跨会话选择和并发、共享步骤CAS、权限通知、稳定前缀、None/卸载/原生压缩、旧私库和失败归档、用量缺失、部分缓存字段、真实归档生命周期。独立评审发现的未跟踪空闲会话清理、并行工具阶段以及部分用量口径问题已纳入回归。旧版`digital-worker:identity`和负责人私库A/B及写入工具结果在新负责人、选择无及卸载时一并退役，只影响本插件当前模型表面，原始审计、原生工具、用户消息和回答保留，交付会话排除。恢复旧历史时按`turn:step:callId`匹配工具结果，避免不同步骤复用编号后把旧员工私库内容误判为当前内容；跨轮次、同轮次跨步骤及同编号原生工具均有恢复回归。

全量复测还暴露了卸载竞态：Cordis可并行释放同级服务，清理时动态获取已下线服务会抛错，导致后续知识归档服务未停止。现于注册时保留官方服务引用，逐个等待所有资源清理，全部结束后再汇总异常；故障注入证明即使前一项清理失败，也会等待归档停止，不靠删除重试掩盖后台写入。

归档验收覆盖：类型检查、完整自动化、实际npm包的原生UI与生命周期、Web/Desktop安装相同归档、宿主程序全文件哈希不变、既有知识/用户数据保留。不得用本机源码运行或合成测试代替归档验收。执行结果、版本、SHA-256和限制记在[0.30.0验收记录](../../integration/verification-0.30.0.md)。

## 官方依据

- [DeepSeek上下文缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)：前缀单元、落盘、命中字段和尽力而为；发布前核查于2026-10-26。
- [DSH rc.3 system-prompt](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/core/system-prompt/README.md)：原生context贡献及in-history更新。
- [DSH rc.3 session](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/core/session/README.md)：不可变事件、当前模型表面与公开替换协议。
- 当前官方安装包导出的`MessageSourceMap`、`TokenUsage`、`Session.deriveMessages`、`SessionController.inspect`、`SurfaceOp`及`agent/assistant-stream`声明；没有使用宿主私有路径或新增宿主接口。

## English

Version 0.30.0 separates local archives from paid knowledge compilation, removes the additional 120k business-token cutoff by default, distinguishes local conversation activity from shared progress locks, and preserves native cache prefixes with one stable role/required-skill definition plus a separate versioned task/knowledge snapshot. Skills remain in the single native catalog. Context changes use official surfaces; native history pressure remains DSH-owned.

Usage is disjoint: uncached input, cache reads/writes, and output. Missing reports remain unknown. Knowledge attempts and version traces have separate immutable accounting; the optional business token limit is neither a monetary cap nor a shared background-compilation limit. Real synthetic Pro/off verification measured 96.18% cache reuse for continuation and 99.88% for exact replay, in the initial cold-prefix run. A later three-call replay measured 99.88% for both continuation and exact replay; its first request reused the earlier synthetic prefix. These are compatibility observations, not guaranteed rates or speed claims. Exact archive verification and upstream cleanup limitations are documented separately.
