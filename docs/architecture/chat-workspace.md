# Chat 工作区：常驻员工与临时 @

适用构建：插件 `0.2.1 / v0.2.1-plugin.4`，官方 DSH `0.2.1-rc.3`。用户在 plugin.4 要求收简入口，取代 plugin.3 的处理模式及资料卡下拉。

## 用户行为

Chat 顶部在项目负责人同一位置显示“选择对话员工”。默认空选择，普通消息由原生助手处理。下拉仅列“无”和员工姓名；选中后只显示员工姓名，并持续处理当前对话，选择“无”退出。其他会话不受影响，刷新恢复选择。正常选择使用员工完整岗位配置，不再显示轻咨询/执行任务、职责说明或资料卡。

在当前输入框 `@` 并选择员工，可只让该员工处理本轮，保留同一个原生 Session、历史、附件和流。临时调用不改变顶部选择；下一轮恢复常驻员工，或交给未绑定时的原生助手。以往 @ 不建立常驻绑定，也不再因临时 @ 打开独立工作单。原生模型选择可能记忆此前模型名；模型名相同不等于员工仍常驻，不强行重置用户的模型。

只有原生实际目录 basename 为 Chat 的工作区采用这些规则，大小写无关并兼容 Windows/POSIX 路径；可重命名的显示标题不决定路由。Chat 不提供底部工作流、步骤或工作流详情，后端与调度器同步限制。普通项目继续使用工作流负责人及原有项目委派。

## 常驻绑定

读取菜单没有模型调用，也不创建员工、团队、工作流或任务。显式选择时才原子创建/复用工作区独立实例，不复用团队成员，不绕过暂停状态。绑定保存真实 project/session/employee 身份，并以 `expectedRevision + expectedVersion` 比较交换。只有当前忙碌会话限制切换，其他会话仍可操作。员工暂停、转入团队或失效会拒绝执行，但允许空闲时退出，不静默改换人选。

新列表选择使用执行能力。旧轻咨询 API、历史记录和显式配置仍兼容；未执行批量数据迁移。重新在列表选择员工会按当前完整岗位能力绑定。岗位设置和知识资料继续在原有库中管理。

## 临时调用的官方入口

使用 DSH 公开 InputTriggerSource / ReferenceInsert / reference codec 和原生默认发送入口，用户原始输入、附件和权限交由宿主管理；插件不自发 session/prompt、不重发文本、不伪造 turn，也不创建额外交付 Session。

选择员工时只插入原生引用，不执行工作。确认发送时签发短期会话绑定票据，再由原生默认 sink 单次发送。直接键入或粘贴行首 @ 员工时，仅从当前轮真实 user 消息按共享确定别名识别显式目标；已知暂停、停用或歧义明确拒绝，其余原生文件引用不被猜测为员工。模型、工具、历史消息和引用资料中的 @ 不构成调用授权。票据只存本插件进程内，有期限、容量上限和单次使用约束；仅当前轮真实 user 消息可消费。同轮准备幂等，其他会话、其他轮、失效目标与多目标冲突拒绝。取消和卸载不会留下长期绑定、定时器或后台任务。

临时目标在显式发送后才原子创建/复用，不写 conversationEmployees。运行记录区分临时调用与常驻调用，不能被旧工作单的输入锁或 handoff 当成独立交付。每个原生轮次冻结一个员工身份，重复装配不重复创建任务；结束释放工具和作用域。每步继续核验当前项目归属、员工状态和权限。临时任务结束不会把未验收的成果写成已验收。

## 上下文与缓存

常驻和临时调用使用原生上下文贡献，稳定岗位、必备技能和工具定义与动态知识分开，不额外注入第二份全量技能目录。同岗位重复调用可复用稳定定义，未绑定/退出/切员工按真实开放轮次退役旧角色及知识贡献。已有历史、工具结果和必要推理仍保留；服务商是否命中以真实 usage 为准，不承诺固定比例。完整岗位按需读取已有授权知识，不因普通问答逐轮付费反思。

原生技能引用、工具、附件、流式输出、Stop、沙箱和审批继续有效。临时身份作用域不会强行改变用户的全局模型或权限。公开接口与历史轻咨询实验证据见[原生接口验证](resident-chat-native-api.md)。

## 历史与生命周期

旧单次委派工作单及成果保留，原有恢复入口、草稿与附件保护继续使用官方 ComposerBlocks，仅保护旧交付会话，不锁当前 Chat 或其他插件。工作单恢复失败可重试；普通 Chat 临时 @ 不再走创建独立工作单路径。

卸载注销 UI/输入来源、reference codec、事件、作用域工具与票据；取消自己拥有的轮次并等待清理，不取消普通原生对话。独立插件数据仍按官方卸载及显式完整清理机制移除，用户项目、交付与宿主共享历史保留。按 [ADR-004](../decisions/004-session-archive-retention.md)，原生可恢复归档隐藏已满足用户要求，不重启物理删除任务。

## English

Chat uses a compact **Select conversation employee** dropdown containing names and **None**. Selecting an employee makes it resident only in that native conversation; None clears it, reload restores it, and other conversations remain independent. Extra mode controls, role descriptions and profile cards are absent.

A composer @ mention selects a temporary employee for this turn in the same native Session, retaining history, attachments, streaming and policies. It never changes the resident selection or creates a separate Chat work-order session. The next turn resumes the resident or native assistant. Public references/codecs and the native default sink send once; bounded, expiring, session-bound tickets validate selected employee references. Direct leading mentions are resolved only from the current real user message using shared deterministic aliases, never from model/tool output or history. No input is replayed or rewritten. A native turn freezes one identity and revalidates authority during execution.

Stable employee/skill/tool definitions remain separate from dynamic knowledge through native context contributions. Previous history and model selection remain subject to native DSH behavior; a model name alone does not indicate residency. Cache reuse is a provider outcome, not a promised percentage. Earlier work orders and their review/handoff paths remain available; project workflows are unchanged.
