# 0.2.1 / plugin.1 归档验收 / Archive acceptance

本次实现 Chat 目录的独立员工模式。插件版本仍为 `0.2.1`，完整宿主兼容范围仍精确限定 `0.2.1-rc.3`；用不可变发布标签 `v0.2.1-plugin.1` 区分同一数字版本的构建，不覆盖旧发布。

- 归档：`dsh-plugin-composable-workforce-0.2.1.tgz`，1,239,019 bytes，393 文件。
- SHA-256：`38376dac12ed41db37e121e8a0ecf443441e6dbd9bbe6bab380121be92b39e7d`。
- 归档源码提交：`160895d33c60c37cbc797446335c0404709be488`；最终 UI 测试提交：`a4dbac1eec6c13549dcf4b2af3f74d21fb538260`。
- 环境：官方 DSH 0.2.1-rc.3、Node 24.21.0、macOS arm64；私有 GitHub 预发布。

## 行为与边界

通过官方 Workspace 路径识别目录名为 Chat 的工作区，包含大小写、尾部斜杠及 Windows 路径规范化，不依赖用户给工作区起的显示名称或本机固定路径。

Chat 不显示底部工作流选择、顶部步骤及工作流负责人；普通对话不创建团队、工作流、员工任务或工作流上下文。后端同时拒绝绑定、运行、评审、继续工作流，运行器与后台调度器也拒绝旧绑定继续执行。旧历史和配置原样保留，取消旧流程的清理入口仍可使用。其他项目的工作流行为保留。

Chat 输入开头的 `@员工 任务` 使用原生输入触发器。候选来自可用的独立员工及自由职业人库；浏览候选和选中均不写数据，提交时才按模板创建或复用独立员工并启动工作单。暂停员工不能通过模板绕过，团队成员不直接充当独立员工。员工使用自己的模型、岗位定义与所需技能，不复制来源会话的旧工作流角色或聊天历史。调用方式是现有独立工作单，未改成在原对话内接管角色。无附件输入限制与仅开头 `@` 的语法见[功能定义](../docs/architecture/chat-workspace.md)。

| 检查 | 结果 |
| --- | --- |
| 类型、构建、prepack | 全部通过 |
| 全量自动化 | 813 项：812 通过，0 失败，1 个可选私有工作区检查跳过 |
| Chat 原生 UI 实包 | 5/5：无工作流入口；真实原生 `@` 候选、选择、提交与复用；岗位模型、职责和技能生效；旧工作流上下文不复制；刷新后保持 |
| Chat UI 模型桩 | 原生 1 次、独立员工 2 次；外部模型调用 0；只创建 1 员工，0 团队，0 工作流；页面错误 0 |
| 原有项目 UI 实包 | 31/31，普通项目工作流保留 |
| 实包生命周期 | 15/15：安装、核心功能、普通卸载、原生宿主、重装、专属清理与数据保留；均绑定本归档 SHA |
| 归档独立审查 | 393/393 文件与工作区一致，140/140 业务源码一致；无宿主补丁、凭据、本机路径依赖、测试或用户运行数据 |
| 解压包版本守卫 | 无开发 SDK / node_modules 时检查通过；明确使用根声明元数据快照，不宣称完整依赖锁校验 |
| 本地 Web / Desktop | 通过官方 CLI 安装同一哈希路径，各 393/393 文件一致；Web 服务健康，Desktop 完整重启后实际 Chat 无工作流选择、步骤或负责人，原生权限和模型选择正常 |
| 原有用户数据 | 两端状态文件及六组定义哈希逐字节相同；Web 68、Desktop 120 个既有不可变知识版本全相同 |
| 官方宿主程序 | Desktop 6,437、官方验证 27,607、实际 Web CLI 63,618 文件的完整哈希均与官方基线相同 |

本次验证未向外部付费模型发送请求，未删除用户历史，也未向 GitHub 上传用户对话、截图、运行日志或知识数据。测试使用独立临时 profile 和合成输入。本地实际 Chat 仅打开和检查界面，没有提交业务问题。Desktop 第一次界面检查发现旧进程仍驻留，确认空闲后完整重启并复核实际显示。

## 仍适用的上游保留项

本次不改变原生持久会话删除接口及闭轮工具历史清理的既有缺口。普通卸载、专属数据清理验证通过，不等于能从宿主共享持久历史中彻底删除插件产生的所有记录。因此继续采用有保留项的预发布状态，不能声称已满足无保留的“完全卸载”。详见[持久会话清理边界](../docs/architecture/session-retention.md)。

## English

Plugin 0.2.1, build tag `v0.2.1-plugin.1`, targets the exact official DSH 0.2.1-rc.3 release. The immutable archive and SHA above identify this build without overwriting the previous 0.2.1 release.

Chat directories no longer expose or execute workflows. Backend admission, direct runtime calls, stale bindings and background scheduling enforce the same policy. Existing history stays intact. Leading `@employee task` uses the native input trigger to create or reuse a standalone employee only on submission. Its own model, role and required skills apply; old workflow roles and source conversation history are not copied. This remains a separate employee work order. Regular project workflows retain their behavior.

Validation passed: 812 unit tests (one optional skip), 5 actual native Chat UI checks, 31 regular project UI checks and 15 archive lifecycle checks. The exact archive was installed in both local profiles, with all 393 files matching. Existing state, definitions and knowledge versions were preserved; all official host program hashes were unchanged. Tests used offline model stubs with zero external model calls. User conversation data, screenshots and logs are not release assets.

The upstream persistent-session deletion and closed-turn tool-history cleanup limitations remain explicit prerelease exceptions; this release does not claim unconditional complete removal of all shared host records.
