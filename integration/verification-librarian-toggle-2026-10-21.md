# 资料管理员开关与员工上下文开发包验证

日期：2026-10-21（Asia/Shanghai）。本记录仅绑定本次开发归档，不替换历史包，不代表已发布到 npm 或已更新用户正在运行的 profile。

## 归档身份

- 开发包：[dsh-plugin-composable-workforce-0.4.0.tgz](../artifacts/librarian-toggle-2026-10-21/dsh-plugin-composable-workforce-0.4.0.tgz)。
- SHA-256：`9c03dce49a24454754f657db45102e5065aa65c2364bbe635dc7d93cbd17b7be`。
- 208948 字节、93 个文件，包含 MIT 许可证与第三方声明。
- [校验和](../artifacts/librarian-toggle-2026-10-21/SHA256SUMS)、[归档内容检查](../artifacts/librarian-toggle-2026-10-21/archive-check.json)、[单测日志](../artifacts/librarian-toggle-2026-10-21/tests.log)、[生命周期机器记录](../artifacts/librarian-toggle-2026-10-21/lifecycle/report.json)。
- 官方兼容目标：@deepseek-ai/dsh@0.2.1-alpha.2，Node.js ^22.19.0 或 >=24；本次 Node.js v24.21.0。

## 已完成验证

- npm test：236/236 通过，npm run build 的 Host、Client 与 TypeScript 声明构建通过，git diff --check 通过。
- 默认启用；模板与项目独立；旧版 team.instantiate 复制模板开关且保留独立分组；旧数据缺省启用。
- 关闭时不新增或更新活动 ABC，停止编纂、拒绝迟到结果；仓储排队、取得写锁后与活动索引提交前重新核对开关。不会回滚关闭前已完成的不可变原始版本文件写入。
- 阻断旧 MemoryRecord 的注入、检索与员工写入兼容路径；显式任务资料继续提供；已注入知识或含子团队知识的委派结果会在团队关闭后阻止下一次模型调用。
- 原生会话、任务、员工、成果及已有知识保留；重新开启从持久化领域记录恢复整理。
- 官方 npm 宿主与独立临时 profile 中，真实浏览器验证了复选框默认状态、键盘切换、模板保存、项目及历史分组独立开关、数据保留与响应式界面。pageerror 和 console error 均为 0。使用未注册的本地 provider，未发起外部模型调用。

界面回归命令：

```sh
WORKFORCE_UI_ARTIFACT_DIR=artifacts/ui/librarian-toggle-2026-10-21-final3 node tests/ui/project-staffing.e2e.mjs
```

截图：[项目关闭状态](../artifacts/ui/librarian-toggle-2026-10-21-final3/project-librarian-disabled.png)、[历史团队独立开关](../artifacts/ui/librarian-toggle-2026-10-21-final3/project-legacy-librarian-disabled.png)、[模板启用](../artifacts/ui/librarian-toggle-2026-10-21-final3/librarian-template-enabled.png)。

## 官方归档生命周期

```sh
WORKFORCE_LIFECYCLE_REPORT_DIR=artifacts/librarian-toggle-2026-10-21/lifecycle node tests/plugin-lifecycle.mjs artifacts/librarian-toggle-2026-10-21/dsh-plugin-composable-workforce-0.4.0.tgz
```

真实归档通过官方 CLI 安装、鉴权目录及知识开关 API、任务和人工成果验收、普通卸载、宿主原生重启、重装及数据逐字节保留、完整清理；用户交付文件和共享凭据保留。测试使用独立临时 DSH_HOME、web profile 与随机端口。未修改用户当前 profile 或宿主安装。

官方程序及依赖 28401 个文件，前后总 SHA-256 均为：

```text
401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003
```

归档不含宿主源码补丁、宿主构建物、node_modules、本机运行数据、凭据、测试夹具或 source map。本插件 Host/Client 构建、相关说明、许可和清理脚本与保存文件逐字节核对一致。

## 验证边界

真实模型端到端 B/C 编纂质量与人工知识质量验收尚未完成；本归档保持开发包身份。C/B 的按任务筛选、单次/累计 token 预算及临时摘要尚未实现；管理员模型输出预算和存储字节上限不等于员工上下文限额。员工上下文实际组成见[团队知识库说明](../docs/architecture/team-knowledge.md#员工每次模型请求的上下文)。
