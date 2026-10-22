# graph_horses · DeepSeek Harness 插件

通过“职业人 Horse → 团队 → 工作流”配置通用模板，再引入具体项目，创建独立实例。项目工作台以目标、任务、成果和验收推进工作，提供列表、看板、任务依赖图和成果版本关系图，继续使用 DSH 原生执行会话。

项目约束：不修改 Harness 源码或构建物，只使用官方公开扩展，支持普通卸载及完整清理，交付独立 `.tgz` 插件包。开发规范见 [AGENTS.md](AGENTS.md)，边界见 [ADR-001](docs/decisions/001-official-plugin-boundary.md)。

## 使用

点击左侧与“插件”同级的 **graph_horses**。页面分为“通用模板”和“项目实例”。

1. **职业人 Horse**：通过岗位定义、模型选择、能力组合、知识与记忆、权限、交付标准六个入口配置员工。职业人独立于团队保存，同一职业人可被多个团队引用。
2. **团队**：引入已经配置的职业人，设置团队内名称、汇报关系和组织层级。同一岗位可多次加入，成员身份分别管理。
3. **工作流**：独立配置负责岗位、步骤任务、输入、输出和验收要求；绑定团队时把岗位分配给成员。已有团队内嵌工作流继续可编辑和导出。
4. **项目实例**：选择 Harness 工作区，通过“引入通用模板”创建职业人、团队或工作流实例。团队一次创建成员及流程快照；独立工作流绑定到该项目已有团队及职业人。实例保留来源及版本，模板后续修改不覆盖实例。
5. **项目工作台**：设置项目目标和完成标准，创建有负责人、输入、必交成果及验收标准的任务。按依赖独立执行或显式启动项目派工；无前置依赖的任务可在预算内并行。列表、看板和依赖图共用状态，成果保留版本与验收历史。
6. **导入/导出 JSON**：选择模板或实例范围，选择职业人、团队或工作流。导入先显示名称、目标、依赖数量和提示，确认后创建独立副本。文件契约见 [JSON 交换格式](docs/architecture/graph-horses.md)。

项目应先在 Harness 中打开，原生稳定 Workspace ID 用作项目身份。全局页面会同步原生工作区。会话输入框的“团队”按钮也可打开本项目配置；原有需要宿主补丁的工作区菜单入口已移除。

配置、生成计划和读取能力目录不会启动工作 agent 的执行任务。已启用资料管理员的团队在新增资料、配置知识或记忆变化时进行模型编纂；首次启动仅归档历史资料，任务启动前会准备本员工可见的知识。进入“项目实例 → 选择项目 → 工作台”，先保存目标，再创建任务；点击“开始任务”只执行该项，点击“启动项目”按依赖派工。任务提交成果后等待人工验收，下游只使用当前已验收版本。上游成果修改会标记受影响的下游需要重新验证，不会自动重做已完成工作。详见[项目工作台](docs/architecture/project-workbench.md)。

已有“工作流”仍按步骤顺序执行、逐步人工验收，也可通过工作台“从已有工作流生成任务计划”复制出可调整的独立任务及依赖。原定义和历史运行保留。在项目会话行首输入 `@` 仍可选择人员提交独立工作单；输入中间的 `@` 交给 Harness 原有引用来源。

## 格式与交付物

| 用途 | 格式 | 内容 |
| --- | --- | --- |
| 安装插件 | `dsh-plugin-composable-workforce-0.4.0.tgz` | Host/Client 插件、内置技能和必要声明 |
| 交换通用模板 | `graph-horses-template-*.json` | 职业人、团队或岗位工作流及所需定义 |
| 交换项目实例配置 | `graph-horses-project-*.json` | 项目职业人、团队或流程快照及所需定义 |

JSON 使用 `format: "graph_horses"`、`formatVersion: 1`，最大 1 MiB。团队及项目流程导出包含必要成员和依赖，导入统一重映射 ID，不覆盖已有对象。模板与实例只导入相同范围；将通用配置用于项目，应先导入模板库，再“引入通用模板”。

JSON 交换范围仍是职业人、团队和工作流配置，不包含工作台的项目目标、执行任务、成果版本、验收或事件记录，也不包含项目路径、私有记忆和凭据。技能与工具仅保存引用，接收环境仍需安装相应能力。自由文本可能含用户自行填写的信息，分享前应检查。项目实例导入默认暂停，清空有效权限及委派授权，原请求权限保留供复核；不会恢复或重放历史任务。

## 员工配置及执行边界

| 模块 | 配置 |
| --- | --- |
| 岗位定义 | 岗位角色、工作职责、规则边界三个大输入框 |
| 模型选择 | 默认跟随 DSH 当前默认模型，也可为员工手动选择模型及其支持的推理力度 |
| 能力组合 | 技能及工具引用 |
| 知识与记忆 | 知识来源、项目共享记忆和员工项目内记忆规则 |
| 权限 | 允许工具、读写目录和执行权限 |
| 交付标准 | 必交产物、验收标准和人工审阅 |

员工页移除“协作规则”页签，但存储、JSON 交换和运行仍保留七模块契约。已有协作规则、委派对象、深度和并发限制继续生效；移除入口不会清空这些配置或扩大授权。

模型选择直接展示 DSH 已有模型列表，按提供方分组。`inherit` 使用 DSH 当前默认的 provider、model 和可选 reasoningEffort，界面默认勾选对应模型；员工手动选择的 `override` 始终保留，不随 DSH 默认值变化。运行从官方 `sessionController.modelCatalog().default` 读取当前默认，不继承来源会话或项目模型；默认不可用时显示错误，不随意选择目录首项，也不批量改写已有配置。

模板与项目实例使用同一套选择器。模型与账号仍在 DSH 中配置，插件只保存选择标识；目录读取不创建会话，也不发起模型推理。接入复用官方 DSH `0.2.1-alpha.2` 已有 Session Controller，无新增 peer 依赖或服务注入；公开类型与实现依据见[模型默认值接入说明](integration/architecture-0.2.1.md#2026-10-21-补充当前员工模型选择开发中)。

能力页通过 DSH 公开作用域租约，从默认 Agent preset 读取实际已安装 Skills，从专属人员 preset 读取实际可执行的基础工具。人员可以选择已安装 Skill；执行时只加载其所选正文。统一基础工具包含文件读取/写入/编辑/搜索、图片读取、Web 搜索与抓取、待办、用户澄清和成果呈现，实际可用性由宿主安装情况和个人授权决定，不需要团队级工具配置。原有受控 `worker_*` 文件、记忆和委派工具继续保留。

运行使用本插件专属官方 Agent preset，只组合经适配的官方工具；不引入默认 preset 的自动指令和子智能体 hooks。文件操作检查项目相对路径、个人读写范围及符号链接，写入/编辑需要单独授权，网络需要网络权限。Bash/终端及任意第三方工具暂不开放：当前没有能兑现上述路径、网络及委派限制的适配。Skills 不会安装工具或自行扩大权限。目录与执行边界见[官方能力接入](docs/architecture/native-capabilities.md)。

项目记忆按项目及职业人隔离，不进入通用模板。每次任务产生独立原生会话；运行使用七模块快照，执行期间仍检查当前授权。已开始但在重启时结果不确定的任务保留为失败供检查，不自动重做。

团队模板和项目团队实例分别拥有 `team` 团队共享库与 `employees/<id>` 员工专属库，各自保存 A 原始资料、B 详细重组知识和 C 概念综述。团队中显示“资料管理员”复选框，默认开启，模型跟随团队唯一负责人；它不占员工名额、不承接工作单，也不创建会话。模板提供默认值，项目实例可独立开关；关闭后停止自动知识归档、整理及长期记忆读取和写入，保留已有知识、任务和原生会话。开启时，工作 agent 默认加载可见 C，再通过已授权的 `worker_memory_search` 读取 B/A；知识综合保持候选状态，任务和成果仍按原验收流程确认。目录、引用、模板快照、员工实际上下文与完整卸载见[团队资料管理员与三级知识库](docs/architecture/team-knowledge.md)。

## 安装与开发

兼容目标为官方 **DSH 0.2.1-alpha.2**、Node.js `^22.19.0 || >=24`；其他 DSH 版本需另行验证。插件通过官方 `sidebar.panellist` + `main` 提供同级入口，不要求修改或重建宿主。安装、普通卸载和完整清理见 [integration/README.md](integration/README.md)。

```sh
npm ci --legacy-peer-deps
npm run setup
npm run typecheck
npm test
npm run build
npm pack --pack-destination artifacts
```

开发依赖链接只修改本项目的 `node_modules`。支持 `DSH_INSTALLATION_MANIFEST` 指向官方 npm 安装的 `@deepseek-ai/dsh/package.json`；源码位置仅为开发回退，不作为正式安装前提。

本地演示：`npm run service:start`、`npm run service:open`。`WORKFORCE_PORT` 指定端口，`WORKFORCE_HOME` 指定独立 profile。`service:status` 查看状态、`service:stop` 停止。启动脚本保留已有安装/移除状态；更新插件后需要重启宿主并刷新页面。凭据由 Harness 管理，不进入插件包。

```sh
# 官方原版、独立临时 profile 的页面验收夹具，不发送模型请求
node tests/ui/graph-horses.fixture.mjs

# 真实归档安装、卸载、重装、完整清理和宿主程序哈希验证
npm run test:lifecycle -- artifacts/dsh-plugin-composable-workforce-0.4.0.tgz
```

页面夹具使用本仓库构建并等待手动/CUA操作；退出清理其临时项目。旧 `tests/ui/*e2e.mjs` 保留历史场景，其中工作区菜单选择器属于旧入口，不能用作本版验收证明。当前验收结果及归档哈希见 [integration/verification.md](integration/verification.md) 和 `artifacts/lifecycle/report.json`。

## 源码

```text
src/domain/       七模块、模板、项目实例、JSON 交换、原子存储
src/work/         项目目标、任务依赖、成果版本、验收、并行调度与恢复
src/workflow/     原有顺序工作流、验收交接、运行状态与恢复
src/harness/      官方 Cordis/Agent/工具/会话接入与权限执行
src/ui/           graph_horses 页面、编辑器和导入导出
src/client/       官方面板插槽、项目会话入口、@ 与 HTTP
skills/           三个内置架构技能
scripts/          构建、启动、官方安装/移除与归属清理
integration/      公开接口基线、安装卸载和验收说明
```

详见 [业务架构](docs/architecture/foundation.md)、[模板/实例与 JSON 契约](docs/architecture/graph-horses.md)、[项目工作台](docs/architecture/project-workbench.md)、[官方能力接入](docs/architecture/native-capabilities.md)与[原有顺序工作流](docs/architecture/workflows.md)。历史宿主源码补丁只作追溯，禁止应用，也不进入归档。
