# 旧项目对话工作流兼容验收

验证日期：2026-10-24 至 2026-10-25。版本：0.18.1。结论：通过。

## 最终交付物

- 安装包：`artifacts/dsh-plugin-composable-workforce-0.18.1.tgz`
- SHA-256：`e609a8f78dec7f4453fe9f89d262c3f388833b6a8b90082257ca0d725bba5e98`
- 大小：1,043,580 字节；359 个文件。包内文件与最终源码、构建物逐字节相同。
- 无宿主补丁、宿主构建物、用户数据、凭据、测试夹具、node_modules 或本机路径依赖。
- 安装、普通卸载、保留数据重装及完全清理步骤见 `integration/README.md`；兼容范围、入口与依赖见包清单，许可见 `LICENSES.md`、`integration/THIRD_PARTY_NOTICES.md`，更新记录见 `CHANGELOG.md`。

机器记录：`artifacts/legacy-conversation-validation/verification.json`。归档清单及校验：同目录 `archive.json`、`package-files.json` 及归档旁 `.sha256`。

## 问题与修正

旧独立员工根工作单仅因保留了历史运行记录，就被永久识别为只读交付会话，导致原生项目对话没有工作流入口，且底部持续显示旧“员工·待验收”。现在已停止的独立根会话可以选择工作流并继承项目默认；底部隐藏旧静止状态，工作单、消息、交付和验收状态均保留。新工作流交付和有关联任务的验收入口仍显示并打开对应执行记录。执行中、待处理消息、子任务、结构化工作流及任务工作台记录继续保留执行限制。

仍由本插件持有的已停止 Agent，通过官方 AgentHandle.dispose 释放自身作用域，再经 SessionController.resolveAgent 恢复相同 SessionId。交接不重发消息、不调用模型、不修改工作流继承或原工作单。发布版控制器实现返回 bare Agent，而声明使用 result envelope；已兼容两种形状及恢复失败后的重试。

官方 alpha.2 客户端会保留旧 Session generation 的 removed 标记，公开同 ID openSession 不能重置。交接成功后，仅当仍在原会话、导航 ticket 有效、无未发送附件且输入不在处理中时，标准刷新页面并恢复同一会话和原生文本草稿。用户离开时不拉回；有附件时保留附件并提示“刷新继续”，处理附件后才允许继续。未读写宿主私有 store，未修改原生组件。

补齐客户端公开 conversation 服务注入，避免附件检查中断恢复。同步修复已安装工作流团队的 `conversation-workflow:<id>` 来源标记被误当目录名校验而导致重启初始化失败的问题；来源标记仍拒绝路径逃逸，实际文件路径继续严格校验。

## 官方边界与验证环境

目标为未修改的官方 DSH 0.2.1-alpha.2、Cordis 4.0.5、Loader 1.0.6。沿用公开原生插槽、Agent/SessionController 生命周期及官方安装管理机制，没有给宿主增加接口。官方步骤插槽位于标题旁，未冒称标题上方整行。

复核发现旧测试安装忽略部分 peer，四项 SDK 可能向父目录源码回溯；旧 0.18.0 记录已注明此局限。此次使用完整独立官方 npm 安装，对全部 39 项 peer 核验精确版本与物理解析边界。独立空目录仅声明官方 dsh 的正常 npm 默认求解也包含全部 39 项，忽略 peers 的对照则与旧环境遗漏的 26 项完全吻合。正式安装不需要修改宿主或额外手工补 39 项依赖。

对照证据位于 `artifacts/legacy-conversation-validation/dependency-audit/`。本地正式运行安装目录为 `.local/official-validation-complete`；旧测试安装未作为此次正式验收环境。

## 测试结果

- 全量测试 619/619 通过；最终服务注入修正后类型检查和客户端专项 23/23 通过。
- 实际官方 AgentLoop、JSONL 持久化和业务适配测试 37/37 通过，源文件哈希与最终运行时一致。
- 最终同一归档在独立官方 profile 的原生工作流浏览器验收 16/16 通过：菜单与继承、共享步骤、同会话负责人路由、验收推进与退回、None、老会话同 ID 恢复、草稿保留、零模型交接、旧记录不变、主动导航不回跳，以及附件保护和安全重试。浏览器无未捕获错误。
- 最终同一归档员工设置完整浏览器回归 67/67 通过；官方命名空间 6426 个文件前后摘要一致，14 个测试进程全部退出，临时 profile 删除，Wiki worker 无残留。
- 最终同一归档安装、使用、普通卸载、宿主原生功能、重装、数据保留、完全清理共 14 项通过。官方程序及依赖 28,779 个文件前后摘要均为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`。

工作流浏览器用测试专用公开 LlmAdapter 返回受控文本，运行真实官方会话和工具流程，不使用用户凭据或真实付费模型。选择碰到 revision 冲突时，测试显式模拟用户刷新后重新选择，不自动重发旧 CAS 写入。

证据：`official-final/report.json`、`employee-final-validation.json`、`employee-final/employee-settings-result.json`、`tests-final.log`、`client-final-tests.log`、`typecheck-final.log`、`official-sdk/`（均位于 `artifacts/legacy-conversation-validation/`），以及 `artifacts/lifecycle-0.18.1-final/report.json`。早期未通过的归档或测试诊断只作历史排错，未记作最终包通过。

## 本地更新与真实老对话

已使用官方 CLI 安装上述最终归档并重启 3081 服务；通过官方 ProfileRuntimeResolution 核对全部 39 项 peer 均来自安装范围，版本一致。已安装 server/client 与归档构建字节一致，用户 profile patch 保持原字节。

重启前后完整插件状态保持 revision 97，两条旧工作单的内容、状态及版本逐字段相同；项目默认、步骤和会话覆盖未改变。原有 413 份知识文件哈希全部相同；另新增 48 份已安装工作流知识空间的来源与初始化文件，没有重跑原任务或触发知识模型重组。

实际打开“你的岗位与默认写入目录说明”和“请用一句话说明你的岗位与允许写入目录”：均显示“工作流：软件工程”、顶部步骤和可编辑输入区，旧待验收底栏消失。未向真实对话发测试消息、未验收或取消旧工作单。最后回到原选中的老对话。

证据：`artifacts/legacy-conversation-validation/live/installation.json`、`data-preservation.json`、`old-conversation-ax.txt`、`old-conversation-workflow.png`。本次未创建工作树；测试 profile、子进程与重复临时 SDK 已清理，实际服务所需官方安装保留。
