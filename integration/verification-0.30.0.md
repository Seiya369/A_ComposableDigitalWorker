# 0.30.0 归档验收 / Archive acceptance

- 归档：`dsh-plugin-composable-workforce-0.30.0.tgz`；1,223,417 bytes；386个文件。
- SHA-256：`d614db9aec6ef18991768a0f48097c48644f40ed113f50f8b299cf1819230276`。
- 归档源码提交：`78c017b`；后续验收记录提交不改变归档内容。
- 官方 DSH `0.2.1-rc.3`，Node `24.21.0`，macOS arm64。
- 状态：带原生持久会话及闭轮工具历史清理保留项的预发布；GitHub保持私有。

根因、口径更正、建议、分步修复及官方缓存依据见[综合核查与修复](../docs/audits/2026-10-26-runtime-context-remediation.md)。

| 检查 | 结果及边界 |
| --- | --- |
| 类型检查、构建、差异检查 | 通过 |
| 最终全量自动化 | 780项：779通过、0失败、1可选私有工作区测试跳过；命令`npx tsx --test --test-concurrency=4 tests/*.test.ts` |
| 官方原生UI实包 | 31通过、页面错误0；跨对话运行门控、权限、步骤、负责人、None、原生模型、旧会话交接和草稿覆盖 |
| 实包生命周期 | 15通过：独立临时profile安装、原生能力、卸载、重装、专属清理及数据保留；无外部模型请求 |
| 静态归档审查 | 139/139源码及386/386包内文件一致；无凭据、本机路径依赖、宿主补丁或打包越界 |
| 实际Web/Desktop | 两端均0.30.0；各386/386安装文件与该SHA归档相同；保留既有团队/工作流/员工定义 |
| 既有知识 | Web68、Desktop87个不可变版本文件哈希均相同 |
| 官方验收安装 | 27,607程序文件前后hash相同：`4320efc9d117186946ef38cbf4078d44d4472de8f9ec42fc107db0b5923c64ac` |
| 实际Web CLI | 63,618程序文件前后hash相同：`f60d186ab9a4bcfeed7004d3add75cbe8e09ab25efa69c4c4eece88636062aec` |
| Desktop程序 | 6,437程序文件前后hash相同：`c3695a48bca37b3b5f8b754bdb7a907c7046e7f8c76aeab346df0247338f1b7b` |

## 缓存与性能

真实供应商验证使用官方Agent、DeepSeekAdapter、原生技能正文和独立内存会话，未写用户会话或改模型/凭据。Pro/off验证参数仅用于合成测试，每次最多3请求、每请求最多128输出；两次实测共6请求，实际合计20,618tokens（未命中3,588、缓存读取17,024、输出6）。首次冷前缀续问命中96.18%、精确重放99.88%；第二次续问和精确重放均99.88%，其首请求已复用前次合成前缀，不是冷启动。

供应商实测发生在最终旧身份/调用编号/闭轮持久化修订之前；这些后续差异有原生请求与严格持久化离线回归，不能将实测报告说成最终归档逐字节再次在线执行。服务端缓存尽力而为，不保证未来命中率；不声称Max推理、模型质量、生产吞吐或冷启动速度提升。默认预算0保持原生输出设置；显式预算的实际最大输出不高于其预留，仍是估算与事后计量保护，非金额硬上限。

本地合成性能审计通过：1,000员工持久化写入p95约242.8ms；1,000文档检索p95约1.25ms；5,000节点布局p95约12.03ms；峰值RSS约413.5MiB。没有LLM调用，不代表浏览器帧率或生产容量。

## 持久化故障与恢复

候选包本机重启暴露闭轮`tool/result`替换不符合官方V4关系校验；发布已暂停，受影响候选从未上传GitHub。已用官方格式目录严格encode→序列化→decode→关系校验→Session.fromRestore复现并修复：工具替换只发生在真实开放轮次，不伪造执行轮次；空闲卸载保留工具历史。

本机8个V4会话中1个受到影响。旧文件及完整备份保留不变，通过官方`buildForkSeed`和`SessionPersistence.create/append/flush`生成恢复副本：继承412条有效事件、完整5轮；仅排除末尾两对无效清理操作，新增官方继承种子标记。新句柄与独立进程严格重读通过，无模型调用。恢复副本已通过公开工作区/会话服务关联并命名“（恢复副本）”，Desktop可正常打开；一次性关联组件已移除。原始会话没有被覆盖或删除。

## 保留项与验证范围

官方rc.3没有持久会话删除接口，且不允许在闭轮后替换工具结果。因此不能承诺卸载时把共享历史中的原始记忆工具内容全部擦除；插件仍在时，新负责人或选无的下一轮准备会安全退役相关结果。原始审计、用户消息和已交付回答保留。完整清理仍有该官方接口缺口，不发布为无保留合规成品。

旧用量中未留存的早期知识编纂记录无法追溯补造；账本只恢复仍有证据的版本trace。独立知识编纂不在可选业务token限制内。Windows、其他架构、任意第三方模型路由及真实生产质量不在本次验收范围。

脱敏详细结果作为`verification-0.30.0.json`发布附件，与该归档SHA绑定；原始用户历史、凭据及恢复备份不上传。

## English

The exact 0.30.0 archive passes 779 tests with zero failures and one optional skip, 31 official archive UI checks and 15 lifecycle checks. Both local profiles match all 386 packed files. All three official host program inventories are unchanged; existing knowledge versions and definitions are preserved.

Repairs cover conversation-local activity versus shared progress, the additional 120k default cutoff, stable native role/skill and knowledge snapshots, nonblocking knowledge reuse, less frequent paid compilation, and disjoint usage accounting. Actual bounded synthetic provider tests observed cache reuse; subsequent safety changes are covered offline, so those measurements are not represented as an online run of every final archive byte.

Final restart testing discovered and fixed an idle tool-result replacement that violated the native V4 persistence contract. One affected local conversation was recovered through public persistence/fork/workspace services into a separately named copy, preserving all five completed turns and the original artifact unchanged. No model call was made for recovery. The temporary association helper was removed.

This remains a prerelease with explicit upstream cleanup exceptions: native persistent sessions cannot be deleted through the official API, and idle uninstall retains historical tool results. Cache rates, monetary caps, Max-reasoning latency, model quality, other platforms and production capacity are not guaranteed. The repository remains private.
