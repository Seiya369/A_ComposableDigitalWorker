# Harness 0.2.1-alpha.2 架构与本次升级

> **历史架构记录，2026-10-18 新约束优先。** 当前执行[官方插件边界约束](../docs/decisions/001-official-plugin-boundary.md)：不修改 Harness 源码或构建物，只使用官方公开扩展机制，并支持完整卸载。本页记录此前 0.2.1-alpha.2 的升级与补丁宿主方案；涉及本项目新增工作区插槽、宿主修改或重建的内容仅作历史说明，不能作为后续实施或发布步骤。此前的保留数据卸载不等于完整卸载；迁移到纯官方发行版及新约束验收尚未完成。

## 2026-10-21 补充：当前员工模型选择（开发中）

本节记录当前源码调整，不改写下文历史方案或既有归档验收结论，也不表示新归档已发布或正式验收完成。

员工页保留岗位定义、模型选择、能力组合、知识与记忆、权限、交付标准六个入口；移除协作规则页签，但七模块数据契约和既有协作运行限制保留。`inherit` 使用 DSH 当前默认 provider、model 及可选 reasoningEffort，手选 `override` 始终优先；不继承来源会话或项目模型，默认不可用时不随意选择模型目录首项。

官方依据为 npm 原版 `@deepseek-ai/dsh-api-session-controller@0.2.1-alpha.2`：

| 公开契约或实现 | 依据 |
| --- | --- |
| `SessionController.modelCatalog(): Promise<ModelCatalog>` | 包内 `lib/types/index.d.ts`，方法说明明确包含 deployment default |
| `ModelCatalog.default: ModelSelection` | 包内 `lib/types/types.d.ts`；`ModelSelection` 只含 provider、model、可选 reasoningEffort |
| 默认值的官方来源 | 包内 `lib/index.js` 的 `buildModelCatalog()` 调用 `ctx.agentDefaultModel.currentSelection()`，复制为返回值 `default`；公开 `modelCatalog()` 调用该构建方法 |

插件继续使用已注入的 `sessionController` 读取 `modelCatalog().default`，只对白名单字段作安全投影；不直接增加 `agentDefaultModel` 注入、peer 依赖或宿主接口。读取目录和默认值不创建会话、不发起推理，也不读取或传递模型凭据。此只读调用无需额外常驻订阅、定时器或独立清理资源，随原有插件作用域释放。

以下为历史架构记录。

源码基线是上游标签 `dsh-v0.2.1-alpha.2`、提交 `d743267388641bc76f17c45ce8b4c231aed1d32c`。本地旧基线为 `0.1.1-rc.2`。新版仍由 Cordis 组合 Host 与 Client 插件；业务插件继续通过服务和插槽接入。

## 按层理解

| 层 | 负责什么 | 在本项目中的例子 |
| --- | --- | --- |
| 1：入口 | 接收启动参数，选择 profile 和数据目录 | `dsh --profile web --port 3080`，本地数据目录 `.local/harness` |
| 2：配置与组合 | 将 bundle、profile patch、额外 patch 合并为本次插件清单与配置 | base 提供基础能力，web-app 加浏览器，workforce 加数字员工 |
| 3：运行时与服务 | Cordis 管理依赖注入、作用域和生命周期 | `agents`、`tools`、`sessions`、`workspaceRegistry` 等服务 |
| 4：执行与记录 | Agent 循环调用模型和工具，记录会话，维护投影与执行上下文 | 员工任务、受限文件工具、持久化结果、Token 用量 |
| 5：接口与界面 | Remote Controller 连接 Host 与 Client，UI 插槽组合页面 | 工作区列表、原生会话、模板库与项目团队菜单 |
| 6：业务插件 | 在这些能力上定义数字员工、团队、权限、记忆和交付流程 | 当前 composable-workforce 插件 |

这是方便阅读的职责分层，源码允许跨层依赖；并非六个独立进程。

## 第 2 层到底在做什么

你可以把它理解为“本次启动的装配单”。模型、工具、界面各自已经有实现；这层选择装哪些插件、给它们哪些配置。Cordis 再按服务依赖激活它们。

本项目真实的 web profile 有以下装配单：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugin-composable-workforce"
      ]
    }
  }
}
```

启动时依次应用这些 bundle 的 patch，再应用该 profile 自己的 `cordis.patch.yml`，最后叠加额外启动 patch。base 装入基础 Agent、工具、会话等能力；web-app 装入服务器、Remote 与浏览器插件；workforce 的 patch 加入数字员工的 Host 和 Client。profile 的 patch 再给 workforce 指定员工数据文件等本机配置。

所以“这次启动什么系统”具体指：同一套代码，这次是浏览器交互系统、SDK 系统还是 ACP 系统，以及其中包含哪些插件。它不决定员工每一步如何推理，也不等于选择 DeepSeek 模型版本。模型选择属于装入插件的配置和运行时行为。

本地删除 workforce bundle 后，重启仍有原生 Harness；加回后，数字员工入口和执行服务恢复，原有业务数据可继续读取。安装生命周期回归验证这条装配边界。

## 与旧架构的区别

| 部分 | 0.1.1-rc.2 → 0.2.1-alpha.2 | 对插件的影响 |
| --- | --- | --- |
| 总体组合 | 仍是 Cordis + bundle/profile patch；增加和完善 SDK、ACP 等组合 | 保留 Host/Client 双入口，不需重写业务层 |
| Client 状态 | 旧 client-runtime 的服务拆到独立 Session/Workspace Controller | 类型与依赖清单改用 api-session-controller、api-workspace-controller |
| 会话导航 | UI 导航由 uiWorkspace 承担 | 使用 `uiWorkspace.openSession()` |
| 浏览器授权 | 本机启动链接换取 Host 签发的 Cookie | 数字员工 API 复用 `connection.admit()`；测试和健康检查先按原生流程登录 |
| Remote | 方法地址使用 `namespace/method`，参数按方法形参名封装在 `args` 中 | 测试和集成工具改用 `workspace/create` + `args.request` |
| Session 与 Agent | 会话格式、投影、系统提示记录及流式/完成事件链路有演进 | 执行回归必须使用新版投影服务，并校验实际事件中的结果与用量 |
| 工具与协作 | 工具模式为 native/ptc，工作目录与异步子代理能力扩展 | 本插件保留 native 受限工具和自身委派权限策略 |
| 工作区扩展 | 上游新基线仍没有本插件依赖的两个工作区附加插槽 | 迁移通用插槽补丁；原生 Menu 已支持 children，无需改 UI primitives |

新版项目菜单贡献位于原生“重命名 / 删除工作区”之后。补丁仅扩展通用插槽及其声明、目录、文档和回归，不替换原生工作区组件。

升级与复现步骤见 [接入说明](README.md)，完成后的验证证据见 [验证记录](verification.md)。Alpha 是此次固定的开发基线，版本检查器不会将其他版本自动视为兼容。
