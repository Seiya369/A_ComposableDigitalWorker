# 持久会话保留与归档（已结项）

状态：2026-10-26 按用户明确决定结项。用户接受归档隐藏，DSH 未提供删除接口时不要求物理删除，见 [ADR-004](../decisions/004-session-archive-retention.md)。

## 当前执行标准

- 使用 DSH 官方可恢复归档隐藏会话，原生日志、消息及闭轮工具历史允许保留，不再作为卸载未满足项或发布阻塞。
- 归档由用户选择；宿主默认拒绝活动会话，明确选择停止活动时才按官方规则请求停止。取消归档恢复显示，不需要重建日志。
- 插件卸载仍须停止全部插件运行资源，并按明确归属清理专属配置、文件、缓存和自建服务；宿主共享数据、凭据及用户成果保留。
- 持久会话删除工作结束，不再跟进删除接口、独立 backend 或离线维护工具。本决定不执行任何会话归档、卸载或数据删除。
- 以下核查保留作历史依据，旧的严格物理清除标准及方案建议不再是当前待办。固定版本的归档与验收记录保留原文，以本次决定补充说明政策变化。

## 历史接口核查

核查日期：2026-10-26。官方最新发布仍为 `dsh-v0.2.1-rc.3`（2026-10-23）；同时核查默认分支 `master` 的 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。没有修改宿主、原生会话、插件源码或用户配置，没有删除数据或发布 issue。

## 已证实的接口边界

- 安装版与官方最新源码的 `SessionPersistence` 完整存储服务仍只有 `create/open/flush/stat/list`。`SessionHandle` 只有读取、追加、刷盘、关闭，没有 remove/delete/purge/retention。
- 官方 persistence README明确列出没有删除或保留策略接口；JSONL README说明持久日志持续累积，外部维护才会移除。
- `WorkspaceRegistry.archiveSession/unarchiveSession` 是正式公开入口，归档隐藏会话并保留日志与工作区位置。默认归档拒绝活动会话；显式 `stopActivity: true` 才请求停止。归档不负责物理删除。
- `WorkspaceRegistry.delete` 只移除工作区登记，不删除项目目录、持久日志或会话；`Workspace.detachSession` 也仅改关联。
- `SessionStore` 的 detach/dispose 仅终止活体发布与释放内存；不是持久数据删除。

## 历史方案对照（原物理清除标准已被取代）

| 方案 | 现在能否做 | 能否解决严格完全卸载 |
| --- | --- | --- |
| 暂停/释放运行资源，归档插件专属交付会话 | 可用官方服务实现，是否归档由用户选择 | 不能；只是执行与可见性管理 |
| 从默认普通对话复用同一个原生Session，减少额外创建 | 当前插件已优先使用此方式；新设计可继续减少一次性会话 | 不能删除现有历史，但减少未来垃圾 |
| 公开 `stat/list` 生成插件专属会话及空间清单，默认 dry-run | 可实现，不依赖私有格式；应基于插件自己的拥有记录，不凭岗位名或cwd猜测归属 | 不能；适合盘点与等待上游迁移 |
| 未来独立 `DSH_HOME`/完整数据根运行插件专属实例 | 官方配置允许；普通 `--profile` 本身只隔离组合配置，不能假设会话数据根隔离 | 只对未来真正隔离、完全归属插件的实例有帮助；既有共享历史不受影响，代价是另一实例/额外运维 |
| 实现独立持久化 backend | 官方允许通过公开服务契约自建backend，但需要完整会话读写/锁/恢复/缓存契约验收，只应用于未来明确隔离的组合；不是在现有backend上加一个delete方法 | 不能自动删除既有默认JSONL日志、普通用户会话或其他索引，当前不宜为卸载需求替换所有用户的backend |
| 停掉所有DSH实例后的离线维护工具 | 技术上可移走/删除所属日志及关联，但属于存储层维护而非正式session删除API；要另行明确授权和完整备份，并遵守当前项目“只经官方方式清理”边界 | 当前不能算正式插件合规解法；不能在运行中直接rm，也不能随普通卸载执行 |
| 上游提供正式删除/回收站API | 当前尚未提供 | 是，共享宿主范围内完整根治的合适方向 |

## 历史删除接口设计调研（不再作为待办）

需要公开、按session身份的删除/回收站协议，明确忙会话/正在写入的拒绝或停止策略；await所有Agent/任务和持久化写入关闭；核对插件所有权与子会话/fork血统，处理其他用户引用；同步清理后端日志、查询/投影索引、工作区/归档/置顶引用及客户端订阅；失败须可恢复且幂等，删除后不能被延迟写回重新创建。不应只新增一个文件 `rm` 方法。

## 当前项目结项范围

继续遵守“不改 DSH、不直接删共享会话目录”的原则。官方归档满足当前会话可见性管理要求，历史存储继续保留是已接受的行为。此次仅结项持久会话删除任务，不安排后续上游提案或存储改造；运行资源及插件专属文件的卸载验收要求继续有效。

## 官方依据

- 发布列表：https://github.com/deepseek-ai/deepseek-harness/releases
- 当前官方存储契约：https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-persistence/src/index.ts#L159-L210
- 官方README限制：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/session/session-persistence/README.md#known-limitations-and-deferred-work
- JSONL后端限制：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/session/session-persistence-jsonl/README.md#known-limitations-and-deferred-work
- 工作区登记/归档语义：https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/subsystems/workspace.md#the-registry-ctxworkspaceregistry
- 自建backend契约：https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-persistence/README.md#choosing-a-backend

## English

The persistent-session deletion task was closed by explicit user decision on 2026-10-26. Official recoverable archiving to hide sessions is sufficient; DSH may keep logs, messages and closed-turn tool history. Physical erasure is no longer an outstanding uninstall requirement or release blocker. Archiving follows native activity safeguards and performs no physical deletion. Plugin runtime resources and explicitly owned files must still be cleaned as selected by the user. The preceding API investigation and deletion designs are historical context, with no follow-up deletion API, backend or offline maintenance work scheduled. This policy update performs no bulk archiving, uninstall or deletion.
