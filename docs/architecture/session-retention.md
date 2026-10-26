# 持久会话删除能力核查（只读）

核查日期：2026-10-26。官方最新发布仍为 `dsh-v0.2.1-rc.3`（2026-10-23）；同时核查默认分支 `master` 的 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。没有修改宿主、原生会话、插件源码或用户配置，没有删除数据或发布 issue。

## 已证实的接口边界

- 安装版与官方最新源码的 `SessionPersistence` 完整存储服务仍只有 `create/open/flush/stat/list`。`SessionHandle` 只有读取、追加、刷盘、关闭，没有 remove/delete/purge/retention。
- 官方 persistence README明确列出没有删除或保留策略接口；JSONL README说明持久日志持续累积，外部维护才会移除。
- `WorkspaceRegistry.archiveSession/unarchiveSession` 是正式公开入口，归档阻止执行并隐藏会话，但保留会话日志与工作区账户位置。
- `WorkspaceRegistry.delete` 只移除工作区登记，不删除项目目录、持久日志或会话；`Workspace.detachSession` 也仅改关联。
- `SessionStore` 的 detach/dispose 仅终止活体发布与释放内存；不是持久数据删除。

## 现实方案及边界

| 方案 | 现在能否做 | 能否解决严格完全卸载 |
| --- | --- | --- |
| 暂停/释放运行资源，归档插件专属交付会话 | 可用官方服务实现，是否归档由用户选择 | 不能；只是执行与可见性管理 |
| 从默认普通对话复用同一个原生Session，减少额外创建 | 当前插件已优先使用此方式；新设计可继续减少一次性会话 | 不能删除现有历史，但减少未来垃圾 |
| 公开 `stat/list` 生成插件专属会话及空间清单，默认 dry-run | 可实现，不依赖私有格式；应基于插件自己的拥有记录，不凭岗位名或cwd猜测归属 | 不能；适合盘点与等待上游迁移 |
| 未来独立 `DSH_HOME`/完整数据根运行插件专属实例 | 官方配置允许；普通 `--profile` 本身只隔离组合配置，不能假设会话数据根隔离 | 只对未来真正隔离、完全归属插件的实例有帮助；既有共享历史不受影响，代价是另一实例/额外运维 |
| 实现独立持久化 backend | 官方允许通过公开服务契约自建backend，但需要完整会话读写/锁/恢复/缓存契约验收，只应用于未来明确隔离的组合；不是在现有backend上加一个delete方法 | 不能自动删除既有默认JSONL日志、普通用户会话或其他索引，当前不宜为卸载需求替换所有用户的backend |
| 停掉所有DSH实例后的离线维护工具 | 技术上可移走/删除所属日志及关联，但属于存储层维护而非正式session删除API；要另行明确授权和完整备份，并遵守当前项目“只经官方方式清理”边界 | 当前不能算正式插件合规解法；不能在运行中直接rm，也不能随普通卸载执行 |
| 上游提供正式删除/回收站API | 当前尚未提供 | 是，共享宿主范围内完整根治的合适方向 |

## 上游删除接口应覆盖的事务

需要公开、按session身份的删除/回收站协议，明确忙会话/正在写入的拒绝或停止策略；await所有Agent/任务和持久化写入关闭；核对插件所有权与子会话/fork血统，处理其他用户引用；同步清理后端日志、查询/投影索引、工作区/归档/置顶引用及客户端订阅；失败须可恢复且幂等，删除后不能被延迟写回重新创建。不应只新增一个文件 `rm` 方法。

## 对当前项目的建议

当前保留现有“不改DSH、不直接删共享会话目录”的原则，继续明确“运行能力/专属文件可清理，宿主持久会话尚有官方接口缺口”。可准备一份上游RFC/PR设计，但发帖、提交PR或删除数据均需用户明确要求。不要为了消除文档保留项而引入私有字段访问、monkey patch或改写旧审计。

## 官方依据

- 发布列表：https://github.com/deepseek-ai/deepseek-harness/releases
- 当前官方存储契约：https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-persistence/src/index.ts#L159-L210
- 官方README限制：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/session/session-persistence/README.md#known-limitations-and-deferred-work
- JSONL后端限制：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/session/session-persistence-jsonl/README.md#known-limitations-and-deferred-work
- 工作区登记/归档语义：https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/subsystems/workspace.md#the-registry-ctxworkspaceregistry
- 自建backend契约：https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-persistence/README.md#choosing-a-backend

## English

The current official release and inspected development branch expose no persistent-session delete or retention API. Archiving or detaching a session does not delete its logs. A separately isolated future instance/backend may make new plugin-owned sessions easier to clean, but cannot remove existing shared history. Offline filesystem maintenance would require a different explicit policy and is not an official plugin uninstall guarantee. The preferred shared-host solution is an upstream transactional trash/delete API coordinating writers, logs, indexes, workspace links and client subscriptions. Existing user conversations and delivered answers should remain after plugin removal.
