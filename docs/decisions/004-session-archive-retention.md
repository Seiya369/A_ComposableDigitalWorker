# ADR-004：持久会话采用归档保留

状态：已接受，持久会话删除任务已结项。

日期：2026-10-26。

## 决策依据

用户明确要求：“归档只隐藏就行，DSH不让删除就不用物理删除。按此结束持久会话删除的任务”。本决定取代 [ADR-001](001-official-plugin-boundary.md) 中要求清除插件创建的全部宿主持久记录、否则列为未满足项的部分。

## 决策

- 采用 DSH 官方可恢复归档管理会话可见性；日志、原始消息、已交付回答及闭轮工具历史可以继续由 DSH 保存，不要求物理删除。
- 未物理删除这些原生持久记录不再是待修缺陷、完全卸载的未满足项或发布阻塞。持久会话删除任务结束，不再为此准备删除接口、独立存储 backend、离线删除工具或上游删除提案。
- 归档沿用宿主规则：默认拒绝活动会话；只有明确选择停止活动的官方操作才请求停止。插件卸载仍必须停止自己的任务、订阅、定时器、服务和入口。
- 插件专属配置、状态、知识文件、缓存和自建服务仍按明确归属及用户选择清理。用户文件、成果、共享凭据和其他插件数据继续保留。
- 本决定不执行批量归档、卸载、文件删除或会话内容改写。需要隐藏某个会话时使用 DSH 原生归档入口。

## 验收与交付

既有固定归档、SHA-256、发布标签及验收记录保留原文，记录当时适用的标准。本决定是此后的政策补充；这些历史记录中的持久会话删除保留项已结项，不能再次据此安排修复。它不新增运行功能，不改变既有测试结果，也不自动把预发布改为正式发布。

本次仅更新项目规则和说明，不生成或覆盖 `.tgz`，不重装 Web/Desktop。当前已安装 `0.2.1 / plugin.1` 的执行代码及哈希保持不变；下次实际打包时继续按新归档重新验收。

## English

The user accepts official recoverable archiving to hide sessions while DSH retains logs, messages, delivered answers and closed-turn tool history. Physical deletion is no longer required, an outstanding uninstall defect or a release blocker. The persistent-session deletion task is closed; no deletion API, backend or offline cleanup project remains scheduled for this purpose.

Native activity safeguards still apply, and uninstall must stop plugin-owned runtime resources and clean explicitly owned files as selected by the user. This policy change performs no bulk archiving or deletion. Historical archives, checksums and acceptance records remain unchanged; prerelease status is not automatically promoted.
