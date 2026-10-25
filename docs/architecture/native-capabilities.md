# DSH 原生能力与员工使用偏好

适用版本：DeepSeek Harness 官方 `0.2.1-alpha.2`，官方源码标签提交 `d743267388641bc76f17c45ce8b4c231aed1d32c`。2026-10-22 起，员工不再拥有独立工具授权页，也不创建排除 Bash 的人员专用预设。仅使用官方公开服务，不修改宿主程序文件。

## 官方依据与接入方式

| 公开能力 | 官方包与接口 | 用途与释放方式 |
| --- | --- | --- |
| 原生工具目录与执行事件 | `@deepseek-ai/dsh-tools`：`schemas`、`get`、`register`、`guard`、`tools/execute` | 显示已安装工具；增加项目业务服务、跟踪实际成果与任务取消；注册与事件随员工会话 Cordis scope 释放 |
| Skill 目录与内容 | `@deepseek-ai/dsh-skill`：`list/get`、`isModelInvocable`、`renderSkillContent` | 按官方 model-invocable 属性读取技能；插件自带技能注册随插件 scope 释放 |
| 已安装插件包目录 | `@deepseek-ai/dsh-plugin-manager`：`listBundles` | 只读已安装/随宿主提供的可读包及启用状态，不返回安装路径，不发起安装或修改 |
| 已配置 MCP 目录 | `@deepseek-ai/cordis-plugin-loader`：`entries`、`Entry.options`；预设注册表 `readDocument` | 只读官方 MCP 条目的静态 `serverName` 与状态；预设声明不执行表达式，不返回 URL、环境变量、命令或凭据；查询无持久资源 |
| 原生插件管理导航 | `@deepseek-ai/dsh-client-ui-plugin-manager/client`：`pluginNavigation.openBundle`；`layout.selectPanel('plugins')` | 未启用包可直达原生详情；通用入口进入原生插件主页面，导航无安装或启用副作用；无新增订阅，随插件 UI scope 释放 |
| 默认/来源会话预设 | `@deepseek-ai/dsh-agent-preset-registry`：`acquireScope`、`composedPreset`、`composeFrom`、`mount` | 查询默认目录，执行时组合来源会话预设或挂载默认预设；查询租约在 finally 释放，执行组合随会话 scope 释放 |
| 原生权限预设 | `@deepseek-ai/dsh-permission-presets`：`current`、`set` | 保留来源会话选择的原生模式，包括 Auto 预设身份；不重新实现审批 |
| 原生沙箱与审批 | `@deepseek-ai/dsh-sandbox-policy`：`resolve`、`setSandboxMode`；`@deepseek-ai/dsh-user-approval`：`setApprovalPolicy` | 将来源会话的沙箱与审批事实写入新工作单会话；执行约束由官方服务负责 |
| 未打开的来源会话 | `@deepseek-ai/dsh-session-persistence`：`open(id, 'read')`、`read`、`close` | 只读解析来源会话的预设事件；finally 关闭句柄，不恢复、重放或删除来源会话 |

接口与类型以官方 DSH npm 包 `0.2.1-alpha.2` 及 Cordis `4.0.5`、Cordis Loader `1.0.6` 随包发布的 `lib/types/*.d.ts` 为依据，运行时依赖见 `package.json`。官方项目为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。其他版本尚未作为兼容依据。

## 员工配置与执行

员工页面只有岗位定义、模型配置、能力组合、认知记忆。旧 `permissions`、`collaboration`、`delivery` 字段保留以兼容历史记录和导入导出；旧路径、Shell、网络及工具白名单不再限制原生工具，旧交付字段不作为新任务的验收条件。任务/工作流步骤及具体成果版本保存验收条件。

- **必备 Skill**：每份工作单开始时读取并加入持续生效的员工指令。旧 Skill 未指定 usage 时按必备处理；不可加载时明确失败。不会在每次工具调用时重复加载。
- **优先 Skill**：模型在任务匹配时优先加载。它是使用策略，不是强制执行证明。
- Skill 已选列表与选择器统一使用 DSH 目录的真实 `name`，并标注来源；目录不可读或该项缺失时显示稳定 ID。旧模板中的中文别名仅保留为悬浮提示，不因渲染修改存储或必备/优先分组。重新选择时同步目录名称，保留既有自定义描述和场景。
- 架构师模板预置的 `architecture-analysis`、`architecture-design`、`technical-review` 来自本插件的 `skills/<name>/SKILL.md`，通过公开注册表随插件加载并释放。旧显示名分别是“架构分析”“架构设计”“技术评审”；它们是本插件自带的岗位方法，来源标签显示“随包提供”。
- **优先插件**：从 DSH 已安装包中选择，按插件包保存引用。未安装的官方目录项不作为已装包；已禁用或不可用项显示实际状态。
- **优先 MCP**：从 DSH 已配置服务中选择，按 `serverName` 保存引用。只识别公开配置中的静态服务名，不通过切分工具名猜测服务，也不执行动态配置表达式。
- 四组均为简洁列表，点击 ＋ 打开对应目录，点击 － 移除引用；无常驻工具总目录和使用说明输入框。移除引用不会卸载 DSH 能力。历史 `tools` 和 Skill 描述/场景保留，继续兼容保存、执行和导入导出。新插件/MCP 引用仅存 `id/name/description`。
- 未启用插件显示可点击的“去启用”，通过公开 `pluginNavigation.openBundle(packageName)` 定位原生详情，由用户在原生页面操作；“在 DSH 中添加插件”进入原生插件主页面，再点击原生“添加插件”。该版本未公开跨插件直开安装弹窗的接口，不调用页面私有 Controller 或模拟 DOM 点击。
- MCP 目录只在官方 Bundle 行的 `entryId` 与 Loader `Entry.id` 唯一精确匹配时附带 `managementBundle`，用于“去配置”跳转所属插件的原生详情。用户 patch、预设内独立配置或归属不明确的服务打开接入说明。当前官方版本没有独立的 MCP 添加页面。导航元数据不进入员工配置或导出文件。
- **基础能力**：文件、终端、上网、原生 Skill 目录等沿用实际原生预设。未配置为岗位能力的 Skill 和工具仍可按任务需要使用，前提是原生服务提供且允许模型调用。

设置页查询 DSH 当前默认预设的目录，独立工作单也使用默认预设。从原生对话发起的工作单继承来源会话预设与权限模式。继承发生在新工作单开始时；修改来源对话不会实时改变已运行工作单。独立工作单遵循宿主默认策略。沙箱模式、审批与各工具自身约束由 DSH 负责，不承诺用原生写入沙箱隔离读取或第三方 MCP 的所有副作用。

项目记忆检索、验收后记忆写入与员工派工作为项目服务自动提供，不需要在员工页勾选。项目归属、员工状态、团队资料员开关、记忆来源、委派目标关系、预算和任务取消继续约束这些服务。内部 `worker_*` 服务不出现在岗位偏好目录。旧 `worker_read_file`、`worker_list_files`、`worker_write_artifact` 不再暴露，文件操作使用原生工具。

## 将 MCP 接入 DSH

1. 按服务方说明准备本地 MCP 程序，或取得已运行远程 MCP 的 URL 和认证方式。
2. 把以下静态配置合并到 `$DSH_HOME/profiles/web/cordis.patch.yml`（仅当前 profile），保留原有配置。远程地址与命令均为占位示例，替换后使用。

```yaml
- insert:
    - id: mcp-company-docs
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: company-docs
        transport: streamable-http
        url: https://your-server.example/mcp
```

本地形式改用 `transport: stdio`，并配置 `command`、`args`、可选 `env` 与 `cwd`。远程需要认证时增加 `headers`，凭据引用环境变量，员工配置不存密钥。

3. 重载配置或重启 DSH，等待工具发现成功，并做一次只读工具调用验证。配置已存在不代表连接成功。
4. 在员工能力页点击“优先 MCP”的 ＋，刷新目录并选择服务。每名员工只保存服务引用，不重复安装服务。

官方依据：[MCP Client](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/mcp/mcp-client/README.zh.md)、[MCP 接入与持久配置](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/docs/user/guide/mcp-memory.zh.md)。本插件只读目录，卸载时不移除用户自行配置的 MCP、其他插件或凭据。

## 成果与知识边界

原生 `write/edit/present` 成功后，根据实际执行结果登记项目内成果，不根据模型口述登记。原生完全访问模式可操作项目外文件，但项目外路径不自动成为项目成果。文本成果保存有界内容快照，`write/edit` 优先取官方返回值的 `after`；`present` 严格 UTF-8、有界读取。二进制、超限或无法读取的文件只保存路径，并标明快照不可用。快照上限为 `min(maxFileBytes, 100000)` 字节。同次执行更新该文件成果；不同执行保留独立快照。

知识库归属仍独立于原生文件能力。员工私库和团队库分别管理，只有明确配置的来源进入插件知识库；原生文件读取能力不会把任意文件自动发布到团队。团队资料员和员工影子整理员使用不同系统提示词，工作单继续按知识开关与来源版本读取 A/B/C。

认知记忆通过插件自己的页面嵌入共享 LLM Wiki 沙箱网页，主图只显示概念／实体和带谓词、方向、精确证据的语义关系；节点度数和社区仅按语义图计算，不按来源、文章、概览和页面链接补线。二维总览紧凑排列全部连通组，包络仅作视觉分组；选择概念突出一跳邻居，沿概念阅读文章和来源证据保留焦点，搜索可定位。完整 A/B/C 页面仍从目录及相关文章同屏阅读，旧无概念图快照也可读文章。单份包级程序及至多一个受管引擎进程服务所有授权空间，员工和团队只持有独立数据及派生索引；不复制引擎或模型密钥。详见[共享接入](shared-llm-wiki.md)。四类短卡为专业知识、任务档案、复盘经验、工作约束，旧六类 ID 兼容归并，历史原文与核验状态保持独立。专业知识提供“上传资料”，打开原有查看、上传和移除窗口；其余三类独立切换“自动归档”，关闭保留旧 A/B/C，开启不立即调用模型补扫。自动编纂按任务稳定阶段合批；移除配置来源时同步员工配置，历史版本、原件及用户项目文件保留。每个知识空间的 `分类目录/<卡片名>/index.json` 为有效来源的派生索引，全部位于本插件数据边界内；这组界面和目录功能不依赖新增宿主接口。

## 原生对话工作流

使用公开 `conversation.input.left` 和 `conversation.session.header.actions` 插槽、`system-prompt/assemble`、`agent/inbox/claimed`、`agent/pre-step`、`agent/request`、`session/event` 与单调工具 guard。每轮在同一原生 Agent 内冻结负责人并追加 required context，保留完整原生 preset，不创建重复用户消息。首次 assembly 注册每轮业务工具后仅通过公开 assemble 重组一次，以保留原生 PTC 和工具 schema。turn 结束释放工具和 lease，选择“无”不注入业务身份、工具或模型覆盖。卸载取消插件持有的活动轮次，等待结算并释放监听，不 dispose 宿主 Agent。

没有标题上方整行的公开插槽，因此步骤条使用标题旁插槽；原生空白会话首次发言前不显示标题与步骤条。详见 [项目对话工作流](conversation-workflow.md)。

## 生命周期与验证

插件关闭时停止并等待工作单与知识编纂，释放持有会话、工具、技能、事件与查询租约；不会修改或注销来源会话的预设。普通卸载保留插件数据，完全清理流程移除插件专属目录，保留用户项目、成果与宿主共享会话。

`tests/native-employee-context.test.ts` 覆盖活动/未打开来源会话、Auto 预设身份及默认模式。`tests/capabilities.test.ts` 使用实际官方 Cordis、预设、Agent Loop、文件/终端/Skill 提供者，覆盖原生上下文、其他 Skill 可用、偏好不限制工具、项目成果快照与执行取消。`tests/plugin-lifecycle.mjs` 对实际 npm 归档在干净官方发行版的临时 profile 中验证依赖、安装、卸载重装、完全清理及宿主文件哈希；每次交付另附绑定归档 SHA-256 的记录。
