# Harness 官方插件接入与生命周期

0.4.0 使用独立 npm bundle，通过官方 `sidebar.panellist` 与 `main` 注册 `graph_horses` 全局页面。项目入口、配置与任务继续使用官方对话插槽和服务。安装、运行和卸载均不修改 Harness 源码、构建物、内置插件或其 `node_modules`。本目录旧的 `harness-workspace-slots.patch` 只保留历史证据，不进入安装包，不得应用它来准备宿主。

兼容目标是官方 **0.2.1-alpha.2**，声明在 `engines.dsh` 和 DSH `peerDependencies` 中。预检检查该版本的已安装官方客户端构建是否公开 `sidebar.panellist`、`main` 和 `layout.selectPanel`。预检通过只说明接口存在；发布是否验收通过，以绑定最终归档 SHA-256 的生命周期记录为准。没有验证过的版本不应改版本号直接放行。

官方依据：

| 接入点 | 官方说明 | 生命周期 |
| --- | --- | --- |
| `dsh.bundle.patch` / profile | [插件发布与打包](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/docs/user/develop/basic/publish.zh.md) | 官方 CLI 管理依赖和 bundle 列表 |
| `sidebar.panellist` | [侧边栏公开面板席位](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/client/ui-sidebar/README.zh.md) | 由 slots 注册清理；无宿主补丁 |
| `main` / `layout.selectPanel` | [布局公开服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/client/ui-layout/README.zh.md) | Cordis 生命周期撤销贡献，刷新页面移除已加载浏览器模块 |
| `connection.admit()` / WebServer | [原生连接鉴权](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/client/connection/README.zh.md) | Host API 路由由插件 effect 注册并移除 |
| `sessionController.modelCatalog()` | [Session Controller 公开模型目录](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/api/session-controller/src/index.ts) | 声明注入 `sessionController`；按需读取宿主当前目录，不另存账号/凭据，不创建会话或发起模型推理；没有额外后台任务 |
| 资料管理员 `llm.stream()` | [官方 LLM 服务与 GenerateOptions](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/llm/llm/src/index.ts) | 使用已声明的 `@deepseek-ai/dsh-llm@0.2.1-alpha.2` peer，显式注入 `llm`；事件驱动单次请求，传入 AbortSignal，插件 dispose 中断队列与请求；不创建原生 Session |
| 知识上下文 `Session.append` / `surfaceOp: replace` | [官方 SurfaceIntent](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/core/session/src/types.ts#L455)、[官方工具结果收拢](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/compaction/compaction-tool-result-pruner/src/index.ts#L136) | 员工作用域 pre-step 只改本插件知识工具的可见 content；先记录 compaction/prune 再替换，保留原始日志与引用；新增声明 token-meter / compaction 原版 peer，计价用公开 estimate 子路径；任务结束/卸载撤销 hook，保留原生可重放历史 |
| `agentPresets.acquireScope()` / 专属 preset | [公开 Agent preset registry](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/preset/agent-preset-registry/src/index.ts) | 目录查询以公开只读租约取得默认 preset 的注册目录，查询完成后释放；任务使用本插件专属官方插件组合，结束释放；无修改默认 preset |
| `workingDirectory` | [公开工作目录服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/session/working-directory/src/index.ts) | 原生任务作用域内绑定项目目录，随 Agent 释放，不改宿主进程 cwd |
| Agent、工具、技能、Workspace | [插件服务机制](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/docs/user/develop/framework/service.zh.md) | 本插件任务、中断、订阅和定时器在 dispose 时停止 |

工作台与原有顺序工作流使用同一个员工执行器。目录读取不建立 Agent 会话；任务执行只装载允许的官方工具及该人所选 Skills。Bash 和尚未适配第三方工具不开放。项目工作台数据存放在同一个插件专属状态文件的可选 `workState`，旧状态无需迁移；安装/升级不会自动创建任务、修改已有人员或发起模型请求。参见[工作台](../docs/architecture/project-workbench.md)及[能力边界](../docs/architecture/native-capabilities.md)。

2026-10-21 开发版本的岗位模型可手动选择，也可通过 `inherit` 跟随官方目录中的当前 DSH 默认值；默认不可用时明确失败，不另选模型。资料管理员按团队唯一负责人的同一路由解析 provider、model 及推理力度。首次升级仅归档 A，不自动编纂历史；新增资料和任务准备会触发后台编纂。具体规则与实现边界见[团队知识库](../docs/architecture/team-knowledge.md)。这些开发变更不沿用旧归档的验收结论。

## 安装与保留数据卸载

先停止目标 Harness。使用你实际要管理的 `DSH_HOME` 与 profile，避免作用于另一套安装。正式使用者只需官方 DSH 和 `.tgz`，无须准备 Harness 源码仓库。

```sh
DSH_HOME=/absolute/dsh-home dsh plugin --profile web add /absolute/dsh-plugin-composable-workforce-0.4.0.tgz --config.auto-install-peers=false --config.strict-peer-dependencies=false --ignore-scripts
DSH_HOME=/absolute/dsh-home dsh plugin --profile web remove dsh-plugin-composable-workforce --config.auto-install-peers=false
```

安装、更新、卸载后重启 Harness，并刷新已打开的页面。普通 `remove` 撤销插件依赖和 bundle，但保留专属配置、职业人模板、团队、工作流、实例、项目记忆、执行记录、团队/员工知识库及工作台目标/任务/成果版本/验收历史，便于重装恢复。

随包提供 `scripts/plugin.mjs`，可以在停止目标宿主后执行同等操作。`DSH_INSTALLATION_MANIFEST` 指向已安装的官方 `@deepseek-ai/dsh/package.json`，不要求源码路径。脚本未传 `--home` 时保留本仓库开发习惯，使用插件目录下 `.local/harness`；正式使用必须明确传目标 `--home`。

```sh
DSH_INSTALLATION_MANIFEST=/official/install/node_modules/@deepseek-ai/dsh/package.json node /installed/plugin/scripts/plugin.mjs uninstall --home /absolute/dsh-home --profile web
```

## 显式完整清理

完整清理使用同一个随包脚本，先预览精确范围。目标 Harness 停止后加 `--host-stopped` 执行；该参数是操作者对停止状态的声明，脚本不会猜测其他正在运行的宿主进程，也不会停止无关服务。

```sh
DSH_INSTALLATION_MANIFEST=/official/install/node_modules/@deepseek-ai/dsh/package.json node /installed/plugin/scripts/plugin.mjs purge --home /absolute/dsh-home --profile web --dry-run
DSH_INSTALLATION_MANIFEST=/official/install/node_modules/@deepseek-ai/dsh/package.json node /installed/plugin/scripts/plugin.mjs purge --home /absolute/dsh-home --profile web --host-stopped
```

`purge` 先校验归属，再通过官方 CLI `remove` 管理依赖与 bundle，成功后才删除以下内容：

- 目标 profile `cordis.patch.yml` 中准确匹配 `id: composable-workforce` 或本包名的配置行，保留其他插件、用户配置和注释。
- `$DSH_HOME/composable-workforce/state.json`。该 JSON 包含本插件的业务模板、项目实例、记忆、运行记录及项目工作台数据。仅删除实际状态文件，并在空目录时移除它的专属目录；不递归删除未知文件。
- 对应 `statePath` 的知识根：`resolve(dirname(statePath), 'knowledge', basename(statePath))`，默认 `$DSH_HOME/composable-workforce/knowledge/state.json/`。先核验 `.owner.json` 归属、文件哈希、目录树和写入锁，再逐项清理；其他状态的知识根、用户项目和原生 Session 保留。预览输出列出 `knowledgeRoots`。
- 没有其他 profile 使用时，home 级 `cordis.patch.yml` 中同样准确匹配的本插件配置行。
- 显式指定 `--service-root /original/checkout` 时，本项目按该路径哈希注册的 `local.composable-workforce.<hash>` launchd 服务及其 `.local/service/stdout.log`、`stderr.log`。未知目录内容会中止清理；不会删除共享日志目录或其他 launchd 服务。

自定义 `statePath` 需要额外传 `--owned-state-path /exact/state.json`，且必须与实际插件配置完全匹配。比如本仓库旧演示状态为 `/absolute/project/.local/workforce.json`，应先预览再显式指定该路径。脚本验证插件状态结构，拒绝状态文件/配置的符号链接、硬链接、动态表达式、正在写入的锁，以及其他 profile 对同一文件的引用。外部状态文件不能证明归属时会拒绝删除。多个历史配置指向不同外部文件时需先核实、统一配置；不会扩大删除范围。

共享 statePath 的多个 profile 不可逐个 purge 同一文件：先用普通 remove 卸载不再使用的 profile，保留数据；仅在最后一个 profile 执行显式清理。其他 DSH_HOME 也引用同一外部文件的情况无法自动枚举，操作者必须确认该外部文件独占使用；不确定时保留文件。

用户项目文件夹、交付成果、用户主动导出的 `.json`、宿主共享会话历史、凭据、模型设置和其他插件数据均保留。员工原生会话属于宿主可查看的历史，不直接改动宿主 session 存储。完整清理指本插件可执行功能与专属配置/状态/自建服务被清除，不声称抹除宿主历史中的所有痕迹。

脚本本身没有创建缓存或专属日志目录；官方插件管理器生成的共享 pnpm 缓存、操作日志和 profile 锁文件由宿主管理并保留。构建和验收产生的仓库 `artifacts/` 是交付资料，亦不由卸载脚本删除。

## 开发与验收

`npm run setup` 可在本插件 `node_modules` 建立开发用只读来源链接；不会写 Harness。`DSH_SOURCE_PATH` 只用于开发源码定位，不能成为正式用户的安装前提。`npm start` 第一次通过官方 CLI 初始化本仓库开发 profile，以后保留现有安装、移除和其他配置状态。

`npm run test:lifecycle` 默认使用 `.local/official-validation/node_modules/@deepseek-ai/dsh/package.json`，或显式 `DSH_INSTALLATION_MANIFEST`。测试要求 npm 安装目录，拒绝源码宿主。它在独立临时 `DSH_HOME` 和随机端口验证真实归档安装、模型目录、默认 preset 实际能力目录、项目目标/任务/成果版本与验收、普通卸载、宿主原生启动、重装完整保留、随包 purge 和宿主程序文件总哈希未变；不会操作现有 3081 profile，也不发送模型请求。`WORKFORCE_LIFECYCLE_UI=1` 允许暂停各阶段供浏览器检查。

发布包使用显式白名单，只含 Host/Client 构建、声明、技能、bundle、生命周期脚本、许可证与所需文档；不含宿主源码补丁、source map、本机数据、测试或完整 Harness。最终验收记录须重新绑定最终 `.tgz` 的 SHA-256，不能借用旧补丁宿主的结果。
