# Chat 工作区：原生聊天与独立员工

适用构建：插件 0.2.1 / GitHub `v0.2.1-plugin.2`；官方DSH 0.2.1-rc.3。Chat 排除工作流及独立员工调用自 plugin.1 提供，plugin.2 澄清候选和身份表达。

## 确定行为

Chat按官方工作区实际目录路径识别：最后一个目录名为`Chat`（大小写无关，兼容Windows/POSIX分隔符和规范化尾斜杠）。不按可重命名的展示标题猜测，不内置用户机器的绝对路径。其他项目目录继续提供原来的工作流能力。

Chat原生对话没有底部工作流选择器、顶部步骤、负责人或流程详情入口。普通发送保持DSH原生模型、权限和对话生命周期，不获取员工工作流租约，不创建工作流运行，也不自动安装团队。旧默认/覆盖、团队与交付历史保留，但不参与Chat路由。HTTP选择、步骤、流程验收、旧结构化流程的新建/启动/恢复均拒绝；取消旧结构化任务仍允许。调度器跳过Chat的旧未取消流程，不自动推进或调用模型；已取消任务的资源收尾保留。

## 显式 @ 单个员工

在行首输入`@`，从自由职业人库或已启用的独立员工中选择，例如：

```text
@产品负责人 帮我梳理这份需求：……
```

仅浏览候选或选择名字不会创建员工或执行任务。确认发送后，按当前岗位配置创建或复用本Chat的独立实例，不复用旧工作流团队成员、不建立团队或工作流。重复调用保留实例自己的配置和记忆，不会以模板覆盖。已暂停的独立实例不会通过新建同岗位副本绕过暂停；草稿/归档岗位不作为新候选。

候选分为“本工作区已启用员工”和“自由职业人模板”，均提示“单次委派”。实例按工作区与模板复用，不按当前对话绑定，因此同一 Chat 目录的其他对话也能选择它。选择后的提示明确“将打开独立工作单”；每次 `@` 新建交付会话，员工不是由于以前被 `@` 过就自动常驻。独立员工配置与授权长期知识可以复用，完整来源聊天历史不自动复制。普通后续输入使用原生助手；过去回答中的自我介绍仍可影响措辞，不能仅凭一句自称判定运行身份。

原生会话会保留其模型选择，刷新后可能仍显示员工任务先前使用的模型；模型名相同不代表员工作用域仍在。本插件不强行重置用户模型。

沿用现有`@`的独立工作单语义：明确任务后打开该员工的原生交付会话，可继续按独立交付入口验收；原Chat不被接管为工作流。员工使用自己的岗位、模型、必备技能、认知与授权记忆。来源对话只用于继承原生预设/沙箱/审批等权限事实，不复制整份聊天历史或旧工作流角色；需要的内容请写在任务中或提供可读取的项目文件路径。输入中间的`@`仍由DSH原生引用处理。附件能力沿用当前独立工作单限制。

独立工作单执行及交接期间，其交付会话的输入由 DSH 官方会话锁暂时保护，原生 Stop 仍可使用，原 Chat 和其他会话可以照常工作。成功交回原生助手后才开放普通发送，避免旧工作单已结束但界面尚未交接时丢掉下一次输入。交接失败显示通用重试提示，草稿/附件继续由原生界面保管。此机制不把一次委派改为员工常驻。

## 服务及生命周期边界

- 原生`/session-project`保留真实项目归属，Chat额外标记`standaloneOnly:true`，不会为了隐藏工作流抹掉员工调用所需的归属。
- `/conversation-workflow`对Chat返回`workflowEnabled:false`和空步骤/候选/负责人；客户端控制器、渲染、HTTP命令及运行时均执行限制。
- `/run`要求`employeeId`和`templateId`二选一；模板目标仅允许来自同一Chat的明确提交。创建/复用独立实例是原子操作，重复提交不重复创建员工；每次明确任务仍是独立工作单。
- 旧完成的独立员工会话通过通用`employee.conversation.resume`交接；不会调用工作流选择，也不重新安装团队。沿用原生草稿、未发送附件及导航保护，必要时只显示通用恢复提示。
- `conversation.blocks` 是官方 Client 公共契约。新工作单导航前先保护交付会话，已有记录在客户端初始化时恢复保护；Host 的 `employeeSessionOwned` 仅是本插件只读 DTO，表示仍由员工持有或等待恢复，不是新增 DSH 接口。确认已释放且不再等待原生恢复后才清除本插件的输入锁，其他插件的锁保持原样；卸载注销订阅并清理自己持有的锁。
- 旧角色/C及记忆工具结果的退役继续遵守官方V4表面/持久化约束，不伪造turn、不修改旧会话文件或删除审计。根据 [ADR-004](../decisions/004-session-archive-retention.md)，原生历史允许保留，按需使用官方归档隐藏，不再要求物理删除。

## English

A workspace whose actual directory basename is Chat uses native chat plus explicit standalone employee mentions. Display titles do not determine policy. Workflow selectors, steps, owners and active details are absent; HTTP/runtime/scheduler checks also prevent inherited or direct workflow execution. Existing history is retained, and ordinary project workflows keep their behavior.

A leading @ can choose a ready library role without a preinstalled team. Browsing and picking are read-only; explicit submission creates or reuses an independent Chat employee and opens the existing standalone work-order flow. The selected role retains its model, skills, knowledge and permission boundaries. Paused instances cannot be bypassed. Only native policy facts are inherited from the source conversation, not its full history or an old workflow identity.

The candidate groups describe enabled workspace instances and freelancer templates. “One-time delegation” and the selected command prompt explain that a separate work order opens. Instance reuse is workspace-scoped, not a resident conversation binding. Ordinary follow-ups return to the native assistant; retained introductions may still influence wording. See the [identity-query audit](../audits/2026-10-26-employee-identity-cache.md) for measured input composition and calling-mode tradeoffs.

Official ComposerBlocks protects only the delivery composer until the native handoff succeeds, preserving Stop, drafts, attachments and other plugins' blocks. The source Chat and other sessions remain available. Failed recovery is retryable, and plugin disposal releases only its own subscriptions and blocks.
