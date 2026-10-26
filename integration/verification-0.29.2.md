# 0.29.2 归档验收 / Archive acceptance

- 归档：`dsh-plugin-composable-workforce-0.29.2.tgz`；1,189,970 bytes。
- SHA-256：`22640fa65dd227c0332cdb99d2c3f9aaebd86408447dacc85b755bb3fdebb84b`。
- 官方 DSH `0.2.1-rc.3`，Node `24.21.0`，macOS arm64。
- 状态：带原生持久会话删除保留项的预发布候选。

## 权限切换回归

0.29.1在干净官方宿主与独立profile复现：原生发送可用、没有模型调用，切换完全权限后权限通知被误判为待执行工作，工作流菜单和顶部步骤禁用。

同一0.29.2实包通过原生权限控件绿测试：`workflowBusy=false`、菜单和步骤均可实际操作、草稿保留、自动模型调用0；下一次真实员工请求仍收到原始权限通知。运行中、真实用户/未知排队消息仍锁定；保留会话拒绝丢弃通知的交接。未重写权限或清空inbox。

| 检查 | 结果 |
| --- | --- |
| 类型检查与构建 | 通过 |
| 全量自动化 | 729项：728通过、0失败、1可选私有工作区测试跳过 |
| 官方原生UI实包 | 30通过，包含真实权限红绿回归、通知保留及原验收闭环；页面错误0 |
| 实包生命周期 | 15通过：安装、使用、卸载、原生宿主、重装、数据保留与专属清理 |
| 官方Web程序 | 27,607个文件前后哈希相同：`4320efc9d117186946ef38cbf4078d44d4472de8f9ec42fc107db0b5923c64ac` |
| 实际本地安装 | Web/Desktop均0.29.2，分别381个安装文件与归档逐一相同；未执行数据迁移 |
| Desktop程序 | 6,437个文件前后哈希相同：`c3695a48bca37b3b5f8b754bdb7a907c7046e7f8c76aeab346df0247338f1b7b` |
| 既有知识 | Web68、Desktop82个既有不可变版本文件哈希相同 |

用户在本地核验期间主动发起了真实原生任务，正常运行锁定被保留；没有为显示按钮而停止、重置或取消任务，因此本地状态会随该真实任务正常变化，不声称状态逐字节相同。空闲权限切换的完整操作证明来自上述独立官方实包测试。

根因、官方实现链和修复计划见[审计报告](../docs/audits/2026-10-26-permission-workflow.md)。脱敏明细在发布附件 `verification-0.29.2.json`。原生持久会话删除接口缺失仍为既有保留项；真实供应商质量、生产部署、Windows和其他架构未验收。

## English

The exact archive fixes idle workflow controls locking after native permission changes. It ignores only official non-waking next-step approval notices in ordinary native sessions, without changing policy, consuming notices or invoking models. Real work and retained-session handoff remain protected.

Verification:728passed tests, zero failures, one optional skip;30official archive UI checks and15lifecycle checks. Real native permission controls and the next owner request verify preserved notices and drafts. Both local profiles match all381packed files. Host programs remain unchanged. User-initiated work continued during local smoke verification; local state is expected to change through that work. Existing upstream cleanup and platform/provider validation limits remain.
