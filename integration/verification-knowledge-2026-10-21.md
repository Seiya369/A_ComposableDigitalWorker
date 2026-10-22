# 团队资料管理员开发包验证

日期：2026-10-21（Asia/Shanghai）。本记录仅绑定下面的归档，不替换历史 0.4.0 发布归档及其验收记录。新增能力的说明见[团队知识库](../docs/architecture/team-knowledge.md)。

## 归档身份

- 开发包：[dsh-plugin-composable-workforce-0.4.0.tgz](../artifacts/knowledge-librarian-2026-10-21/dsh-plugin-composable-workforce-0.4.0.tgz)。没有发布到 npm，也没有更新用户正在运行的 profile。
- SHA-256：`e42f4693169b520f1197ef99761feef651b0c2d5c2aefb3c164719c2c8d7bc11`。
- 204170 字节，92 个文件；MIT 许可证及第三方声明随包提供。
- [SHA256SUMS](../artifacts/knowledge-librarian-2026-10-21/SHA256SUMS)、[归档内容检查](../artifacts/knowledge-librarian-2026-10-21/archive-check.json)、[生命周期机器记录](../artifacts/knowledge-librarian-2026-10-21/lifecycle/report.json)。
- 兼容目标：官方 npm `@deepseek-ai/dsh@0.2.1-alpha.2`，Node.js `^22.19.0 || >=24`。本次运行使用 Node.js 24.21.0。

## 已完成验证

`npm test`：222 项通过；`npm run build` 包含 TypeScript 声明与 Host/Client 构建，全部通过；`git diff --check` 通过。

知识测试覆盖隐藏管理员不新增员工/Session、唯一负责人及默认模型路由、团队和员工隔离、模板首次种子快照、原件保留、规范文本、来源版本和准确行号、C→B→A 引用、候选状态、原子发布、来源撤回、文件授权收窄、待编纂时的原始索引、人工成果验收与退回、跨团队独立队列、中止与迟到结果、立即停止后的完整归档和重启逐文件一致性。工作执行测试覆盖仅注入 C、通过已有授权工具读取 B，以及来源撤回后停止继续向模型发送旧上下文。

真实归档通过官方 CLI 安装到独立临时 `DSH_HOME`、web profile 和随机端口。生命周期命令：

```sh
WORKFORCE_LIFECYCLE_REPORT_DIR=artifacts/knowledge-librarian-2026-10-21/lifecycle node tests/plugin-lifecycle.mjs artifacts/knowledge-librarian-2026-10-21/dsh-plugin-composable-workforce-0.4.0.tgz
```

验证了鉴权后的模型/能力目录、项目记录与人工成果验收、普通卸载、宿主原生页面、重装、知识文件逐字节保留、随包脚本完整清理以及用户交付物和共享凭据保留。隔离夹具将负责人设为未注册的本地 provider，失败发生在外部推理之前；未使用用户实际模型账户。

官方安装树及依赖共 28401 个文件，前后总 SHA-256 均为：

```text
401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003
```

归档中没有宿主源码补丁、宿主构建物、node_modules、本机状态、测试夹具、凭据或 source map。归档内本插件 Host/Client 构建、相关说明、许可及生命周期脚本与保存文件逐字节一致。

## 验证边界

真实模型的端到端 B/C 编纂和人工知识质量验收尚未完成。本记录确认开发包的接口、隔离与生命周期，不将脚本模型测试等同于真实模型效果或完整生产验收；本归档保持开发包身份。

A 当前支持文本原件、来源/完整性和体量检查、同源精确去重、BOM/换行/NUL 规范化及稳定行号；尚无 PDF/OCR、音视频解析或跨来源语义去重。B/C 结构检查不证明事实正确，模型综合保持候选状态。当前单次编纂有输入 100000 字节、输出 6000 token 和超时上限，超限保留资料并提供可发现的 A 索引。

用户项目、已交付文件和原生 Session 属于保留数据。资料管理员通过官方 LLM 服务运行，不读写宿主 Session 数据库；普通卸载保留知识文件，只有显式完整清理才移除本插件拥有的知识目录。
