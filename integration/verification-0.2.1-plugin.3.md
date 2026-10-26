# 0.2.1 / plugin.3 验收记录

日期：2026-10-26。官方 DSH **0.2.1-rc.3**，macOS arm64，Node v24.21.0。源提交 `eb1d1e55a1d116dabaa042e5f6e63954257c86f9`；发布标签 `v0.2.1-plugin.3`，包版本仍为 `0.2.1`。本记录绑定下列归档，不覆盖旧发布。

- 文件：`dsh-plugin-composable-workforce-0.2.1.tgz`
- SHA-256：`cd4c92030065be87aa0ec0aeb8a298c7a36ebd05895ddafc1b83c10c057c033c`
- 大小：1,284,526 bytes；407 文件，146 源码文件。逐字节匹配工作区；独立解包版本检查通过，不需要开发 SDK。

## 本次落实

Chat 顶部在项目“XXX 正在对接”相同位置提供“常驻此对话”下拉。默认不常驻，显式选择/切换/退出，刷新恢复；旧 @ 不建立绑定，单次独立工作单行为保留。员工信息卡本地展开，不调用模型。绑定使用双版本 CAS 和真实原生会话归属，仅当前忙碌会话限制切换，暂停或失效后仍能退出。

轻咨询只提供岗位摘要和已有原生对话，不初始化岗位长期知识或必备 Skill，不新增工具 schema/自动目录，也不执行历史或意外工具调用。公开 restriction、guard 与权威 PromptAssembly 配合，覆盖 PTC 的 transport 例外，轮次结束精确撤销。用户显式原生技能/附件保留，模型/推理不暗中降低。工具执行继续完整能力、权限及交付验收。普通咨询不自动进入长期知识归档或付费编纂。

常驻使用同一个原生 Agent/Session、历史、流式输出与停止；没有复制、重发或伪造用户轮次。稳定角色只保留一份，动态知识分开。退出/换人通过官方开放轮次表面退役，历史允许保留。

## 复测结果

| 验证 | 结果 |
| --- | --- |
| 单元测试 | 858 总计，857 通过，0 失败，1 项可选私有克隆跳过 |
| TypeScript / 构建 | 通过 |
| 官方 Chat 常驻界面 | 8/8，覆盖两轮咨询、执行、忙碌隔离、暂停退出、刷新、键盘和窄屏 |
| 官方 Chat 单次委派 | 8/8 |
| 官方项目工作流界面 | 31/31 |
| 干净临时 profile 安装/使用/普通卸载/原生运行/重装/完整清理 | 15/15 |
| Web / Desktop 安装文件 | 各 407/407 与此归档一致 |
| 原有状态及 7 类定义 | 两端哈希原样 |
| 不可变知识版本 | Web 68、Desktop 134；改写 0、新增 0 |
| 三份宿主程序树 | 6,437 / 27,607 / 63,618 文件哈希原样 |

顶部文字与原生 tabs 底线均为 66px；1512/1024/768 宽度下菜单可操作、无越界，无页面错误。发现并修复窄屏 popup 使用固定偏移导致的 11px 越界。安装包不含用户数据、凭据、本机依赖、宿主构建或源码补丁。实际 Desktop 已打开默认常驻菜单，Web 服务健康且插件加载；未提交用户业务问题或改变用户常驻设置。

## 测量与限制

完整产品岗位种子及 22 份随包技能、官方文件/技能插件的离线新会话对照：轻咨询模型消息 2,649 字节、工具 0；执行消息 13,844 字节、工具 7 个。轻咨询知识准备/必备技能正文均为 0；执行各为 1。执行仅发送一份原生技能目录。

以上是 UTF-8 消息/schema 测量，夹具不是完整 Desktop 的 32 工具配置。全部新增验收使用离线 Adapter，外部模型调用 0；不能据此承诺实际 token、账单、首字延迟或固定缓存命中比例。已有历史、目录及必要推理保留，频繁切模式可能使输入增长。执行成果仍须人工验收，咨询完成不等于工程成果已验收。按 ADR-004，物理会话删除任务保持结项。

## English

This immutable build adds explicit Chat residency at the project contact position, local employee cards and consultation/execution modes. The native assistant remains the default; prior mentions never bind an employee. Residency shares the original native Session, history and stream. Public scoped restrictions, execution guards and authoritative prompt assembly remove new consultation tools/catalogs without modifying Harness. Consultation skips automatic long-term knowledge processing; execution preserves capabilities, policies and human review.

All 858 unit tests completed with 857 passes, no failures and one optional skip. Official UI checks passed 8 resident + 8 standalone Chat + 31 project workflow cases, with 15 lifecycle checks. Both installed profiles match all 407 archived files, prior state/definitions and 68/134 immutable knowledge versions remain unchanged, and all three official program trees retain their hashes. Byte comparisons are offline structural evidence, not provider token/cache/cost claims. Exact DSH compatibility remains 0.2.1-rc.3.
