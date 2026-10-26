# 0.2.1 归档验收 / Archive acceptance

插件版本只取官方DSH的主、次、补丁号。当前插件为`0.2.1`；实际验收宿主、`engines.dsh`、官方基线和37个DSH runtime peer仍精确为`0.2.1-rc.3`。不把同core的其他预发布版自动视为兼容。

- 归档：`dsh-plugin-composable-workforce-0.2.1.tgz`，1,230,439 bytes，390文件。
- SHA-256：`a13138491b378d416d1eacffb74713e3541b0f169b94087fcbdea8168142b10c`。
- 归档源码提交：`695d82c`；Node 24.21.0，macOS arm64。
- 状态：私有GitHub预发布，原生持久记录清理保留项继续适用。

| 检查 | 结果 |
| --- | --- |
| 版本守卫专项 | 7/7；core提取、完整宿主限制、错误声明/陈旧快照/开发锁缺失均验证 |
| 类型、构建、prepack | 通过；打包输出可机器解析 |
| 解压包独立版本检查 | 无node_modules/开发SDK，使用`packaged-root-metadata`快照检查通过；不声称检查完整依赖锁 |
| 业务源码 | 139/139与原0.30.0归档逐字节一致，无功能回退 |
| 全量自动化 | 787项：786通过、0失败、1可选私有工作区测试跳过；`npx tsx --test --test-concurrency=4 tests/*.test.ts` |
| 官方原生UI实包 | 31检查通过，页面错误0，绑定本归档SHA |
| 实包生命周期 | 15检查通过：安装、普通卸载、原生宿主、重装、专属清理及数据保留，绑定本归档SHA |
| 本地Web/Desktop | 均0.2.1，各390/390文件与本归档一致，安装后的独立版本检查通过 |
| 现有用户数据 | 两端状态文件逐字节相同；Web68、Desktop120个既有不可变知识版本均未改 |
| 官方程序文件 | Desktop 6437、官方验收 27607、实际Web CLI 63618文件均与先前已验收官方基线hash相同 |
| 新安装包边界 | 无凭据、本机路径依赖、宿主补丁、测试或用户运行数据；根版本快照为必要声明元数据 |

这次明确安装较小数字版本，只是由旧0.30.0切换编号规则，不依赖SemVer自动更新，不迁移用户数据。旧发布与验收记录保留。后续构建/打包自动核对[ADR-003版本策略](../docs/decisions/003-host-aligned-versioning.md)，同core构建以不可变标签和SHA区分。

当前官方rc.3及核查的默认分支仍没有持久会话删除/保留策略API。归档或移出工作区不删除日志。未来真正隔离的实例/backend仅有助于新专属记录；不能自动清理既有共享历史。删除方案和边界见[持久会话清理核查](../docs/architecture/session-retention.md)。本次没有删除任何用户会话、修改宿主程序、发布上游issue或调用付费模型。

## English

Plugin 0.2.1 uses only the verified host's numeric core; exact host compatibility remains DSH 0.2.1-rc.3. All 139 business source files match the former 0.30.0 archive. Build/prepack guards check versions and root-lock metadata; the standalone archive explicitly uses the packaged metadata snapshot rather than claiming a full dependency-lock check.

The exact archive passes 31 official UI and 15 lifecycle checks. Both local profiles match 390 packed files; user state and existing knowledge versions are preserved, and official program inventories are unchanged. The numeric downgrade is a renumbering, not a functionality rollback. Private prerelease status and upstream persistent-history cleanup exceptions remain.
