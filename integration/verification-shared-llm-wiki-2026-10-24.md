# 共享 LLM Wiki 开发验收记录（2026-10-24）

本记录验证 `dsh-plugin-composable-workforce@0.4.1` 共享 Wiki 改造的最终归档，含两步编纂累计时间预算的修正。浏览器验收使用实际归档，在官方发行版的临时 profile 物理展开程序和网页；运行时 peer 及测试依赖由开发环境提供。另以同一归档通过官方 CLI 完成独立临时 profile 的安装、普通卸载／重装及完全清理，不以页面检查替代生命周期验收。

被测归档：`artifacts/dsh-plugin-composable-workforce-0.4.1.tgz`，861,127 字节，SHA-256：

```text
e2d266d0f56ed7112e2fd5b84bf086ae208b66333bc123ea80ff2ce5849e34ff
```

## 上游与实现范围

- 上游：[nashsu/llm_wiki](https://github.com/nashsu/llm_wiki)，版本 `0.6.13`，commit `e08cfce65aad8b76b13546a081c1a8d4422b70c3`。
- 单份包级程序：`third_party/llm-wiki/`，独立产物 `lib/llm-wiki/engine.cjs` 与 `web.html`。固定上游源码和许可的 SHA-256 在 `UPSTREAM.json`，本地改造单独保留对应源码。
- 实际复用：Markdown/frontmatter/Wikilink 页面图、四信号关联评分、Louvain 社区以及原版分析提示。网页复用圆点网络、类型／社区着色及同屏阅读交互，使用受限 JSON 数据和安全 Markdown 渲染。
- 不启动上游 Tauri 桌面、Rust Agent、更新器、模型凭据库、研究或 MCP 服务；不宣称完整接入这些上游能力。
- 编纂两步均通过 DSH 公开 `llm.stream`；员工和团队继承各自配置的模型，凭据留在宿主。

## 验证状态

| 验证 | 状态与证据 |
| --- | --- |
| 两员工＋一团队 API 空间隔离 | `npx tsx --test tests/shared-wiki-api.test.ts`，7／7 通过；同时覆盖非法目标、关闭资料管理员、恶意路径及资料变化后的晚响应 |
| 原件和历史知识保护 | API 测试对比 A 原始字节、旧 B 文件字节、有效来源记录，重编保持一致 |
| A v2 更新但新编纂失败 | 活动 A 为 v2，旧 B/C 与 Wiki 仍可读，传入引擎和原文读取均精确使用被引用的 A v1 |
| 同一受管子进程及关闭清理 | `tests/llm-wiki-runtime.test.ts` 6 项通过，覆盖 3 空间实际单进程、取消／超时、跨空间响应与凭据环境清理 |
| 官方独立临时 profile 浏览器验收 | 24 项通过，实际归档 SHA 与本记录一致；[结果 JSON](../artifacts/ui/employee-settings-result.json) |
| 构建及全套单元测试 | 最终 383 项通过、0 失败；其中专门 API 和 runtime 套件已列，不额外叠加计数 |
| 实际本地页面及在线模型编纂 | 真实两步编纂 ready，快照 v3，15 个概念、4 篇文章、22 个页面节点、61 条关联，2 份来源的版本／哈希保持一致；[在线证据](../artifacts/ui/shared-wiki-live-result.json)、[实际界面](../artifacts/ui/shared-wiki-live.jpg) |
| 官方安装、普通卸载／重装、完全清理 | 最终归档通过 13 项生命周期检查；官方 CLI 从本地归档安装，复用包管理器已缓存的精确依赖；[完整报告](../artifacts/lifecycle-0.4.1/report.json) |

浏览器夹具只在临时 profile 注册离线 LLM adapter，不读取用户账号、密钥或知识资料；第一步返回分析文本，第二步返回带行号依据的确定性知识。保留六类上方布局、专业资料查看／上传／删除、配置资料删除后的草稿保留、原生能力导航、原件哈希、精确版本引用、深浅色和窄／短屏检查。

新增浏览器检查包括：`sandbox="allow-scripts"` 的单份网页、实体／概念／来源／概览／综合页面、同屏文章与原文、类型／社区切换、搜索和真实画布缩放／平移／节点拖动、两个员工和一个团队共享一个引擎进程，以及关闭宿主后的引擎进程退出。最终结果与截图记录在 `artifacts/ui/employee-settings-result.json` 和相邻 PNG。

实际页面产出 5 页、7 关联，具备全部五种类型；原有明确谓词“依据”及第 4 行证据保留，概念依据可精确打开第 5 行，文章和原文阅读始终与图谱同屏。三空间为两个员工私库与一个团队库，`spaceId` 均不同，只有一个 `engine.cjs` 子进程，停止宿主后该 PID 不存在。

执行命令：

```sh
WORKFORCE_UI_ARCHIVE=artifacts/dsh-plugin-composable-workforce-0.4.1.tgz node tests/ui/employee-settings.e2e.mjs
```

浏览器为安装的 Chrome `155.0.8059.85`。主程序及 manifest 验收前后联合 SHA-256 相同：`118f419925fe988d98c3d6f114ae1967d23ca931df9d77a562757f9848a582a1`。鼠标平移与拖点使用真实 Sigma canvas 输入，DOM 记录了 `CANVAS.sigma-mouse` 的按下、移动、释放事件，以及相同文档、空间和版本；没有用直接修改 camera 或节点状态替代交互。

全套结果：[单元日志](../artifacts/llm-wiki-validation/unit.log)；最终编译器、runtime 和 API 针对测试为 23／23（10＋6＋7），记录在[针对测试日志](../artifacts/llm-wiki-validation/targeted.log)；[浏览器日志](../artifacts/llm-wiki-validation/e2e.log)及结果 JSON 均为通过。Wiki 两步请求共用 240 秒默认总预算，未启用 Wiki 的旧单步编纂保持 120 秒；显式配置仍为整个调用的累计总预算，取消仍立即传递。针对测试包括第二步累计超时与用户取消，不重置第二步预算。

最终生命周期命令：

```sh
npm_config_offline=true WORKFORCE_LIFECYCLE_REPORT_DIR=artifacts/lifecycle-0.4.1 node tests/plugin-lifecycle.mjs artifacts/dsh-plugin-composable-workforce-0.4.1.tgz
```

该流程实际执行官方插件 CLI，未链接开发 checkout 或改写宿主。首次在线运行已完成依赖缓存；最终归档验证使用离线缓存。归档内共享引擎独立运行原版页面关联和社区分析；认证静态页具有禁网 CSP。普通卸载移除入口与 API、保留知识字节和配置状态，重装后原员工、项目、记忆及交付历史完全一致；完全清理移除专属数据与配置，保留用户成果和宿主凭据。官方宿主及依赖共 28,401 个程序文件，前后联合 SHA-256 都为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。

已目视检查：

- [图谱与同屏文章正文](../artifacts/ui/employee-settings-wiki-article.png)
- [现有员工资料的实际图谱](../artifacts/ui/shared-wiki-live-graph.jpg)、[实际文章阅读](../artifacts/ui/shared-wiki-live.jpg)
- [概念与相关文章入口](../artifacts/ui/employee-settings-concept-details.png)
- [关系和精确证据](../artifacts/ui/employee-settings-relation-evidence.png)
- [深色](../artifacts/ui/employee-settings-knowledge-dark.png)、[浅色](../artifacts/ui/employee-settings-knowledge-light.png)
- [窄屏](../artifacts/ui/employee-settings-knowledge-narrow.png)、[短屏](../artifacts/ui/employee-settings-knowledge-short.png)

原有六类均为 36px，高度和上方顺序已核验；只有投喂马料可点击。能力列表、原生插件／MCP 导航、删除资料后的草稿合并与旧版字段保持原检查。

## 文件与资源归属

共享程序不写入每个员工或团队目录。空间内仅保存原有 A/B/C、原件、分类目录和派生 Wiki 数据。模板安装时的资料快照继续独立，员工换团队不复制私库。普通卸载保留资料，完全清理沿用知识根 `.owner.json`、文件树、哈希、锁和路径检查。用户项目、已交付成果、原生会话及共享凭据保留。

宿主程序不新增接口或补丁。HTTP API 及 iframe 静态页使用既有插件 `webServer` 注册，卸载由 Cordis 生命周期撤销；受管引擎停止接收请求并退出，不保留独立后台服务。

## 许可与发布检查

上游及改造子程序使用 GPLv3，根 MIT 不覆盖它。最终归档已包含对应源码、修改说明、许可、依赖声明／锁、构建脚本和第三方声明，276 个文件、861,127 字节。打包清单未发现宿主补丁、node_modules、本机数据、凭据、测试或 source map；[归档清单](../artifacts/shared-wiki-package-inventory.json)与[SHA-256](../artifacts/dsh-plugin-composable-workforce-0.4.1.tgz.sha256)绑定本记录的归档。相关说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [共享接入规格](../docs/architecture/shared-llm-wiki.md)。本验收仅覆盖记录中的官方版本与接入范围，不代表上游独立桌面及 Agent 全部能力已接入。
