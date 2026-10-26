# 0.2.1 / plugin.2 归档验收 / Archive acceptance

本次修正员工身份表达、Chat 候选的作用域提示、独立员工上下文排序及完成后的原生交接。插件数字版本仍为 `0.2.1`，实际宿主兼容仍精确为官方 DSH `0.2.1-rc.3`，使用不可变标签 `v0.2.1-plugin.2` 区分构建。

- 归档：`dsh-plugin-composable-workforce-0.2.1.tgz`，1,253,160 bytes，397 文件。
- SHA-256：`d73b86634b6063924abb32e71413eeb4bd0885630c579437fbff3da1bf7fbd6f`。
- 归档源码提交：`34ddc01e9e571c817596f5a1bab1c67eb424905e`。
- 环境：macOS arm64、Node 24.21.0、官方 DSH 0.2.1-rc.3；私有 GitHub 预发布。

## 行为与测量边界

员工自我介绍只展示姓名、岗位与可提供的帮助，内部 UUID、路径、配置和工具协议不主动输出；必要路由资料保留并后置。这是统一表达规范，不是对任意模型生成内容的绝对防泄漏保证，历史回答不改写。

独立工作单的稳定职责、通用规则与必备 Skill 正文在动态 C、资料和名册之前。两项真实离线 Agent 测试证明知识或项目文件更新不改写稳定段，内容不丢失、不重复，原生权限和工具保留。它不代表实际服务商缓存百分比已经提高，也没有把完整 Agent 改成轻咨询模式。

Chat 菜单明确显示工作区已启用实例与自由职业人模板，提示单次委派和打开独立工作单。实例按工作区复用，每次 `@` 新建交付会话，普通后续输入回原生助手。原生会话可保留已选模型；模型名相同不代表员工常驻。

额外修复了完成后立即普通发送的交接竞态。使用官方 `conversation.blocks` 保护独立交付输入，Stop 保留，原 Chat 与其他会话不受影响；确认旧作用域释放及原生恢复后才解除。恢复失败、待重开、已有草稿/附件、其他插件的输入锁、初始化期间卸载和迟到导航均有覆盖。没有给 DSH 增加接口、替换原生组件或拦截重发用户消息。

## 最终归档验证

| 检查 | 结果 |
| --- | --- |
| 类型、构建、prepack 版本守卫 | 全部通过；插件 0.2.1，37 个 DSH peers 精确 rc.3 |
| 全量自动化 | 830 项：829 通过、0 失败、1 个可选私有工作区检查跳过 |
| Chat 原生实包 UI | 8/8：真实 `@`、候选/选择只读、实例复用与新交付会话、身份规范入参、即时无 `@` 续聊及旧交付刷新续聊、无员工上下文/工具残留、无新增员工运行 |
| 原有项目原生实包 UI | 31/31：原工作流、权限、共享进度、导航取消、交接前已有草稿/附件保留、附件安全重试等全部通过 |
| 实包生命周期 | 15/15：安装、核心功能、普通卸载、原生宿主、重装、专属清理及数据保留，绑定本 SHA |
| Chat UI 模型桩 | 原生业务 3 次、员工业务 2 次、外部模型请求 0；统计按本轮业务输入区分，不以模型名字误判；页面错误 0 |
| 归档独立审计 | 397/397 文件及 141/141 源码与工作区字节一致，5 个主要编译入口一致；无凭据、本机数据/依赖、测试夹具、宿主程序/补丁或 tar 链接 |
| 解压包独立版本守卫 | 无 node_modules / 开发 SDK / 根 package-lock 时通过；明确使用根声明元数据快照，不宣称完整依赖锁校验 |
| 本地 Web / Desktop | 官方 CLI 以同一哈希路径安装，各 397/397 文件一致；Web 服务健康、Desktop 完整重启；实机候选分类已确认，没有发送业务问题 |
| 用户数据 | 两端状态和六组定义哈希相同；Web 68、Desktop 134 个既有不可变知识版本全部相同 |
| 官方程序文件 | Desktop 6,437、官方验证 27,607、实际 Web CLI 63,618 文件完整哈希均与官方基线一致 |

真实项目界面中，旧测试在故意暂停交接后才输入草稿，会与新增的原生输入保护死锁。现用首次只读 GET 的测试网络 gate 先形成已有草稿/附件，再触发交接；锁期间确认原内容仍在，之后保留所有恢复断言。没有依靠睡眠、删除断言或手动调用交接 API 让测试通过。

两次真实身份问答的输入/输出与组件字节构成、官方缓存依据及后续建议见[核查报告](../docs/audits/2026-10-26-employee-identity-cache.md)。本次没有额外调用用户的付费模型来宣称实际命中率或费用改善；离线桩只能证明接入、顺序和生命周期。用户原始会话、截图、凭据、知识正文及运行日志不进入 GitHub 发布资产。

原生会话按用户已接受的归档保留策略管理，物理删除任务已由 [ADR-004](../docs/decisions/004-session-archive-retention.md) 结项，不再列为卸载未满足项或发布阻塞。本次不删除或批量归档会话，旧版本、哈希及历史验收记录保留。

## English

Plugin 0.2.1 build `v0.2.1-plugin.2` targets exact official DSH 0.2.1-rc.3. The archive and SHA above identify this build without overwriting earlier releases.

Employee introductions avoid unsolicited internal metadata. Stable role/Skill context precedes variable knowledge, and Chat copy distinguishes workspace instances from resident conversation bindings. Official per-session ComposerBlocks closes the completed-work-order handoff race while preserving Stop, other conversations, drafts, attachments, native model selection and other plugins' blocks.

Validation passed: 829 automated tests with one optional skip, 8 actual Chat UI checks, 31 regular project UI checks and 15 archive lifecycle checks. Both local profiles match all 397 packed files. Existing state, definitions and knowledge versions remain unchanged, as do official host program hashes. Tests use offline model stubs with zero additional external model requests; they do not establish a guaranteed provider cache hit rate or cost reduction.

User conversation data and screenshots are not release assets. Persistent-history retention is accepted under ADR-004; physical deletion is no longer an outstanding uninstall requirement or release blocker.
