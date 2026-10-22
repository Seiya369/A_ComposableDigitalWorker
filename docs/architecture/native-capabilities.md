# DSH 原生工具与人员 Skills

适用版本：DeepSeek Harness 官方 `0.2.1-alpha.2`。本接入不修改宿主源码、构建物、内置插件或配置中的其他 preset。

## 官方依据与接入方式

| 公开能力 | 官方包与接口 | 本插件用途 |
| --- | --- | --- |
| 原生工具目录与执行策略 | `@deepseek-ai/dsh-tools`：`schemas(scope)`、`get(name, scope)`、`restrict`、`register`、`guard`、`tools/pre-execute`、`tools/execute` | 显示目录、限制继承工具、执行前检查权限；原生工具实现保持不变 |
| Skills 目录与指令加载 | `@deepseek-ai/dsh-skill`：`list/get({ cwd, scope, signal })`、`isModelInvocable`、`renderSkillContent` | 查询当前项目可用技能，只加载该人员选择且允许模型调用的指令 |
| 默认 preset 的只读查询 | `@deepseek-ai/dsh-agent-preset-registry`：`acquireScope()` 及其 `Symbol.asyncDispose` | 读取 DSH 默认 preset 所配置的工具与技能提供者，不创建会话，不运行模型 |
| 独立人员工具组合 | 同上：`register(PresetDefinition)`、`mount(agentCtx, id)` | 注册插件自己的 `composable-workforce` preset，在员工会话创建的 `setup` 中挂载 |
| 当前工作目录 | `@deepseek-ai/dsh-working-directory`：`ensure(agent, signal)` | 每次原生文件操作确认会话仍处于当前项目根目录 |

以上接口取自这些官方 npm 包 `0.2.1-alpha.2` 随包发布的 `lib/types/*.d.ts`。官方项目为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；对应包为 [dsh-tools](https://www.npmjs.com/package/@deepseek-ai/dsh-tools/v/0.2.1-alpha.2)、[dsh-skill](https://www.npmjs.com/package/@deepseek-ai/dsh-skill/v/0.2.1-alpha.2)、[dsh-agent-preset-registry](https://www.npmjs.com/package/@deepseek-ai/dsh-agent-preset-registry/v/0.2.1-alpha.2)。其他版本尚未作为兼容依据。

Web 版把许多工具和 filesystem Skill 提供者放在 preset 的作用域，单独读取 host 全局 registry 无法得到实际目录。本插件使用公开租约查询默认 preset，同时查询专用人员 preset 中实际可执行的默认工具。租约在查询结束后释放。

人员执行只挂载专用 preset，组合六个官方插件：`dsh-tool-fs`、`dsh-tool-fs-search`、`dsh-tool-todo`、`dsh-tool-web`、`dsh-tool-ask-user`、`dsh-tool-present`。不挂载通用 preset 的 `agent-instructions`、Bash、原生 subagent/workflow 等额外逻辑。这样不会由通用 AGENTS 加载器读取未列入人员知识与路径授权的材料，也不会产生绕开项目任务记录的另一套委派。

已安装 Skills 从默认 preset 的公开读取租约查询与加载；不会重复挂载 Skill 提供者。该租约贯穿当前执行，执行结束后释放。插件自有的 scoped `skill` 工具调用公开 `skills.get`，只接受当前人员所选技能；原生全目录 Skill 发布器因作用域解析到不同的工具定义而不向此人员发布未选技能目录。这是官方公开的 scoped registration，不修改宿主的工具定义。

## 统一默认工具与个人权限

默认工具在插件层统一组合，不在团队层配置。工具存在不等于人员可以对任意对象操作；岗位配置快照、当前配置和委派链的每一层授权必须同时允许。

| 工具 | 人员授权要求 |
| --- | --- |
| `read`、`read_image` | 明确的同名工具权限，或仍有效的旧 `worker_read_file` 能力与权限；目标必须匹配 `readPaths` |
| `glob`、`grep` | 明确的同名工具权限，或仍有效的旧 `worker_list_files` 能力与权限；搜索文件需对应读取权限，搜索目录需覆盖整个目标子树 |
| `write`、`edit` | `allowedTools` 显式包含对应原生工具名；匹配 `writePaths`。已有文件还需 `readPaths`，因为编辑与覆盖差异可能透露旧内容 |
| `web_search`、`web_fetch` | 每层人员的 `allowNetwork` 均为 true；实际提供者继续由 DSH 的官方 Web 服务选择 |
| `skill` | 只可加载该人员快照和当前配置共同选中的 Skill；允许模型调用且当前仍可从官方 registry 加载 |
| `todo_write`、`ask_user_question` | 当前有效人员任务的安全默认能力；实际需宿主服务可用 |
| `present` | 明确的同名工具权限，或旧 `worker_read_file` 双重授权；文件须匹配 `readPaths` |

旧 `worker_*` 工具继续保留原有双重授权与边界。尤其 `worker_write_artifact` 仍是排他新建：不会因为升级自动得到覆盖、修改现有文件的权限。原生 `write/edit/present` 成功后，由实际工具执行结果登记项目成果文件，不根据模型声称登记。

文本成果同时保留文件路径和有界内容快照，避免后续改写同一路径使历史版本指向新内容。原生 `write/edit` 使用官方工具规范化返回值中的 `after`，这是提供者完成该次操作后的实际内容；`present` 则在检查实时读取权限后对现有文件做严格 UTF-8、有界读取。旧新建工具保存实际写入内容。同一次执行再次修改同一文件时更新该次成果；不同执行的内容快照各自保留。

快照上限为 `min(maxFileBytes, 100000)` 字节，包括空文本。二进制、超限或当前不能安全读取的文件保留路径，并在 `mediaType` 中明确标注 `x-graph-horses-snapshot=unavailable-binary`、`unavailable-too-large` 等原因。这类成果仅是文件引用，不具有可回放的文件内容历史；要长期保存应另行保留版本化文件。

`docs/**` 可以授权在 `docs` 目录中搜索；若只授权 `README.md` 或 `docs/**/*.md` 等部分文件，则不能用 `grep` 搜索整个项目或整个目录。可缩小目标或通过受控文件工具读取。文件操作拒绝项目外路径、符号链接和当前目录漂移。异步路径检查失败后，即使其他 pre-execute 策略返回允许，单调 guard 仍拒绝执行；工具即将执行时再次验证实时授权。

新增原生工具权限不要求再次把默认工具写入 `capabilities.tools`。后者保留旧工具兼容以及个人特殊工具声明。界面与运行时共用 `nativeToolEntitlement`，避免显示与实际授权逻辑不一致。

Skills 的指令不会自动扩大工具、网络或文件访问范围。项目外的辅助脚本和资料不因选择某项 Skill 自动变为可读；Skill 需要但人员未获授权的能力应显示为缺口。

## 当前不能开放的能力

官方 Bash 沙箱的公开策略明确只覆盖文件写入效应；项目外读取、网络和进程可见性不在该策略词汇内。因此不能用它兑现现有人员的 `readPaths` 与 `allowNetwork`，本版本即使人员配置 `allowShell: true`、选择 `bash` 或宿主具备 Bash，也不会将它交给人员。相关 `job_*` 控制同样不开放，避免产生脱离任务取消与回收范围的后台工作。

任意第三方工具也不会仅因安装就获得执行资格。目录可以显示其公开工具名与说明，但会标记尚无权限适配，不能通过填写 ID 绕过限制。未来增加特殊工具，需要先为其文件、网络、外部操作、委派、取消与回收语义做明确适配。

## 生命周期与验证

所有 scoped 工具、guard、事件与工具限制由人员会话的 Cordis scope 持有。插件关闭时先停止与等待运行中的工作，再释放保留会话，最后注销专用 preset。查询和执行持有的读取租约均在 `finally` 释放；不留下独立后台服务或修改其他 preset。

`tests/capabilities.test.ts` 使用真实 Cordis、官方 preset registry、官方 Agent Loop、官方文件、观察策略与搜索工具、官方 Skill filesystem 提供者和官方 Web 工具，模型由测试脚本驱动；不调用生产模型或外部网络。覆盖原生读取、编辑和成果登记、独立执行保留不同文本快照、空文本和二进制/超限引用标记、越界与符号链接拒绝、目录子树授权、实时网络撤权、旧新建权限不扩大、已安装 Skill 按人加载、未选 Skill 拒绝、默认 preset 的 AGENTS hook 不进入人员请求，以及后续宽松策略不能覆盖路径拒绝。官方 Bash 工具注册后仍不会继承，测试同时验证其 executor 未被调用。
