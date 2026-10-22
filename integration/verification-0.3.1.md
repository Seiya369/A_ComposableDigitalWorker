# 0.3.1 官方发行版归档验收

日期：2026-10-18（Asia/Shanghai）。本记录绑定最终归档。0.3.0 的归档、[人工验收记录](verification-0.3.0.md)和[机器报告](../artifacts/lifecycle/0.3.0-report.json)保留。

- 归档：`dsh-plugin-composable-workforce-0.3.1.tgz`
- SHA-256：`b30834bab9293a6827b9d32dc72c3532260e26720ccaf1b6c53444338c35ba09`
- 归档大小：133602 字节；69 个文件。
- 宿主：从 npm 独立安装的官方 `@deepseek-ai/dsh@0.2.1-alpha.2`；没有修改源码、构建物或内置插件。
- 隔离：独立临时 `DSH_HOME`、web profile、随机端口；本次归档验收不操作用户现有 3081 profile。
- 命令：`node tests/plugin-lifecycle.mjs /absolute/artifacts/dsh-plugin-composable-workforce-0.3.1.tgz`
- 机器记录：[0.3.1-report.json](../artifacts/lifecycle/0.3.1-report.json)，校验文件：[SHA256SUMS](../artifacts/SHA256SUMS)。

## 已通过

1. 官方 CLI 从真实 0.3.1 归档安装到临时 profile，安装对象不是源码链接。
2. 通过原生鉴权读取插件 `/models`，实际调用官方 `sessionController.modelCatalog()`；浏览器响应仅含允许的模型选择字段，读取目录没有创建员工运行记录。
3. 创建项目实例、员工、项目记忆和项目工作流；本地不存在的模型适配器产生可保留的失败记录，不向外部模型发送推理请求。
4. 普通官方 remove 撤销插件 bundle；重启后插件 API 消失，宿主原生页面正常，业务状态文件逐字节保留。启动脚本不会自行重新安装。
5. 重新安装同一归档恢复相同模板、员工 ID、权限、记忆、冻结工作流及失败记录，没有重复实例或自动重放任务。
6. 执行归档随附的 `scripts/plugin.mjs purge`：先走官方 CLI remove，再移除专属 profile 配置与默认状态文件；用户交付文件及宿主共享凭据保留。清理后宿主原生页面正常启动。
7. npm 包白名单核对没有宿主源码补丁、source map、源码、测试、本机数据、用户数据或宿主构建物；旧 0.3.0 归档的 SHA-256 仍匹配历史校验值。
8. 官方安装树含依赖的 28401 个文件，安装、卸载、重装与清理前后总 SHA-256 相同：`401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。

## 模型选择补充验证

主流程报告：build、typecheck 及 126 项领域/运行测试通过。官方临时环境的真实浏览器验收从原生目录给职业人模板选择 Flash/High，为项目成员甲选择 Pro/Max、乙选择 Flash/Low，分别保存后通过 API 检查配置独立持久化，运行记录数为 0。最后一版还阻止“指定岗位模型”尚未选择模型时保存，并显示提示；随后重新构建，归档生命周期在本记录绑定的最终包上重跑。

本轮不调用真实模型完成任务，也不验证外部账号的模型推理可用性。模型与凭据仍由 Harness 管理；插件只保存所选 provider/model/reasoning 标识，目录读取采用官方服务。

## 清理安全边界

针对性测试另验证了：预览只读、CLI 尚未 remove 时不删数据、自定义 statePath 需要完全匹配的显式归属声明、其他 profile 共享状态拒绝删除、非插件格式/符号链接/硬链接/过期计划拒绝删除、保留其他插件配置及其嵌套业务内容、不删除依附本插件 id 的其他插入配置。

原生员工会话作为宿主共享历史保留；本验收不声称抹除宿主历史痕迹，也不手工修改共享 session/credentials 存储。自建服务和日志清理由显式 `--service-root` 定位，临时目录测试覆盖其专属日志删除；本次生命周期没有创建或移除真实用户的 launchd 服务。后续若随包文件改变，必须重新打包并绑定新哈希重新验收。
