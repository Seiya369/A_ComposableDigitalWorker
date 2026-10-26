# 0.2.1 / plugin.4 验收记录

日期：2026-10-26。官方 DSH **0.2.1-rc.3**，macOS arm64，Node v24.21.0。源提交：`ccf5a0599c28de19f49977e27be5aed45385c307`。包版本保持 `0.2.1`，不可变构建标签为 `v0.2.1-plugin.4`。

- 归档：`dsh-plugin-composable-workforce-0.2.1.tgz`
- SHA-256：`c893471e6b2e5ac94f18a13fd567dde8a6b0e64eb64f6fac611e7cf523ca9f00`
- 大小：1,290,252 bytes；407 文件，146 源码文件。

## 行为与修正

顶部默认空选择，按钮文字为“选择对话员工”。菜单只列员工姓名和“无”，选中即常驻当前对话，选择“无”取消。选中后显示姓名，刷新保留；额外模式、职责说明、资料卡已移除，位置与项目负责人一致。

Chat 输入框 @ 改为同一原生对话内的临时单轮调用，保留用户历史、附件、流和权限，不修改常驻选择，也不新开交付会话。下一轮恢复常驻员工或原生助手。新选择按完整岗位配置工作；旧轻咨询 API 和配置兼容，不批量改写用户状态。普通项目及旧独立工作单保留原行为。

选择候选使用官方引用、codec 与默认发送入口。票据仅内存、有容量和期限、会话/目标版本绑定及单次使用约束；手输或粘贴仅从本轮真实 user 消息识别确定的行首别名。模型、工具和历史文本不构成授权。暂停、歧义、多目标及跨会话使用拒绝；只在用户真实发送后原子创建/复用实例。每轮冻结负责人，稳定职责/技能定义可在临时与常驻之间复用；不重发或伪造消息。

修复候选引用被已归档同名模板误拒的问题：明确 ID 的候选按票据目标校验，原始名称优先匹配当前可用别名，仍拒绝真正歧义或第二位员工。图片测试使用真实支持图片的离线模型和有效 PNG，确认原生图片 block 与正文保留。

## 最终复测

| 项目 | 结果 |
| --- | --- |
| 单元测试 | 884 总计，883 通过，0 失败，1 项可选私有克隆跳过 |
| TypeScript / 构建 / 解包版本检查 | 通过 |
| 官方简洁菜单与临时 @ | 8/8 |
| 官方 Chat 与旧交付兼容 | 8/8 |
| 官方项目工作流界面 | 31/31 |
| 干净 profile 安装/使用/卸载/原生运行/重装/完整清理 | 15/15 |
| Web / Desktop 已安装文件 | 各 407/407 与归档逐字节相同 |
| 原有状态与全部定义 | 两端哈希原样 |
| 不可变知识版本 | Web 68、Desktop 134，改写 0、新增 0 |
| 三份宿主程序树 | 6,437 / 27,607 / 63,618 文件哈希原样 |

同一对话临时 A 覆盖常驻 B、原生图片发送、下一轮恢复 B、直接粘贴 @、取消选择后临时 A 再回原生助手、并发会话隔离及旧交付交接均有真实官方 Agent/界面回归。菜单 240px 宽、234px 高，原生 tabs/按钮文字底线均 66px；1512/1024/768 宽度无越界，页面错误 0。实际 Desktop 已显示简洁列表，Web 服务健康且插件加载，未发送用户业务问题或更改用户常驻选择。

安装包不含用户数据、凭据、本机路径依赖、宿主构建或补丁；独立解包在无开发 SDK 下的版本检查通过。全部模型响应为离线夹具，外部模型调用 0。历史与必要推理按原生规则保留，缓存以服务商真实报告为准，不承诺固定比例或费用；物理会话删除任务按 ADR-004 保持结项。

## English

This build replaces the expanded Chat menu with **Select conversation employee**, names and **None**. A selection makes the employee resident only in that conversation; an @ mention temporarily invokes an employee for one turn in the same native Session. The next turn restores the resident or native assistant. Native attachments, history, streaming and policies remain; no message is replayed and no extra Chat work-order Session is created.

All 884 unit tests completed with 883 passes, zero failures and 1 optional skip. Official UI checks passed 8+8+31 cases and 15 lifecycle checks. Both installed profiles match all 407 archived files; original state, definitions, immutable knowledge versions and official program hashes remain unchanged. Acceptance uses offline responses, with no provider usage/cache/cost guarantee. Compatibility remains exact DSH 0.2.1-rc.3.
