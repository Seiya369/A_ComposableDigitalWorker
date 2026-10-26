# Chat 工作区：原生聊天与独立员工

适用构建：插件 0.2.1 / GitHub `v0.2.1-plugin.1`；官方DSH 0.2.1-rc.3。

## 确定行为

Chat按官方工作区实际目录路径识别：最后一个目录名为`Chat`（大小写无关，兼容Windows/POSIX分隔符和规范化尾斜杠）。不按可重命名的展示标题猜测，不内置用户机器的绝对路径。其他项目目录继续提供原来的工作流能力。

Chat原生对话没有底部工作流选择器、顶部步骤、负责人或流程详情入口。普通发送保持DSH原生模型、权限和对话生命周期，不获取员工工作流租约，不创建工作流运行，也不自动安装团队。旧默认/覆盖、团队与交付历史保留，但不参与Chat路由。HTTP选择、步骤、流程验收、旧结构化流程的新建/启动/恢复均拒绝；取消旧结构化任务仍允许。调度器跳过Chat的旧未取消流程，不自动推进或调用模型；已取消任务的资源收尾保留。

## 显式 @ 单个员工

在行首输入`@`，从自由职业人库或已启用的独立员工中选择，例如：

```text
@产品负责人 帮我梳理这份需求：……
```

仅浏览候选或选择名字不会创建员工或执行任务。确认发送后，按当前岗位配置创建或复用本Chat的独立实例，不复用旧工作流团队成员、不建立团队或工作流。重复调用保留实例自己的配置和记忆，不会以模板覆盖。已暂停的独立实例不会通过新建同岗位副本绕过暂停；草稿/归档岗位不作为新候选。

沿用现有`@`的独立工作单语义：明确任务后打开该员工的原生交付会话，可继续按独立交付入口验收；原Chat不被接管为工作流。员工使用自己的岗位、模型、必备技能、认知与授权记忆。来源对话只用于继承原生预设/沙箱/审批等权限事实，不复制整份聊天历史或旧工作流角色；需要的内容请写在任务中或提供可读取的项目文件路径。输入中间的`@`仍由DSH原生引用处理。附件能力沿用当前独立工作单限制。

## 服务及生命周期边界

- 原生`/session-project`保留真实项目归属，Chat额外标记`standaloneOnly:true`，不会为了隐藏工作流抹掉员工调用所需的归属。
- `/conversation-workflow`对Chat返回`workflowEnabled:false`和空步骤/候选/负责人；客户端控制器、渲染、HTTP命令及运行时均执行限制。
- `/run`要求`employeeId`和`templateId`二选一；模板目标仅允许来自同一Chat的明确提交。创建/复用独立实例是原子操作，重复提交不重复创建员工；每次明确任务仍是独立工作单。
- 旧完成的独立员工会话通过通用`employee.conversation.resume`交接；不会调用工作流选择，也不重新安装团队。沿用原生草稿、未发送附件及导航保护，必要时只显示通用恢复提示。
- 旧角色/C及记忆工具结果的退役继续遵守官方V4表面/持久化约束，不伪造turn、不修改旧会话文件或删除审计。根据 [ADR-004](../decisions/004-session-archive-retention.md)，原生历史允许保留，按需使用官方归档隐藏，不再要求物理删除。

## English

A workspace whose actual directory basename is Chat uses native chat plus explicit standalone employee mentions. Display titles do not determine policy. Workflow selectors, steps, owners and active details are absent; HTTP/runtime/scheduler checks also prevent inherited or direct workflow execution. Existing history is retained, and ordinary project workflows keep their behavior.

A leading @ can choose a ready library role without a preinstalled team. Browsing and picking are read-only; explicit submission creates or reuses an independent Chat employee and opens the existing standalone work-order flow. The selected role retains its model, skills, knowledge and permission boundaries. Paused instances cannot be bypassed. Only native policy facts are inherited from the source conversation, not its full history or an old workflow identity.
