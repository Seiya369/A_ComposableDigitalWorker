# ADR-003：插件版本与官方 DSH 对齐

状态：采纳；2026-10-26；用户明确要求。

## 决策

插件公开包版本与已实际验收的官方 DSH 版本逐字一致，包括预发布后缀。当前插件由`0.30.0`切换为`0.2.1-rc.3`；功能仍为原0.30.0已验收基线，此次不回退功能、不重置或迁移用户数据。数字变小是编号规则切换，不表示旧代码。

`package.json.version`、`engines.dsh`、所有`@deepseek-ai/dsh-*`运行时peer、`integration/harness-baseline.mjs`与lockfile根版本保持一致。Cordis等非DSH依赖保留其真实版本，不伪装成DSH版本。

构建和npm prepack执行`npm run check:version`，任一处不一致立即失败。脚本只检查版本声明一致性，不等同于接口存在、原版兼容或完整卸载验收通过。

## 后续更新

1. 确认官方发行版与目标Web/Desktop程序版本，研究公开API和变更。
2. 更新插件实现及全部对应声明；不修改宿主程序或安装目录。
3. 在干净官方发行版、独立profile完成类型、功能、归档安装/卸载/重装与数据保留等检查，核对宿主文件哈希。
4. 以该DSH版本命名npm包和GitHub首个发布标签，交付新的SHA-256和绑定该归档的验收记录。未经验证的其他版本不自动放行。

## 同一宿主版本的插件独立修订

包版本继续等于DSH版本；使用独立GitHub构建标签，例如首发`v0.2.1-rc.3`，后续`v0.2.1-rc.3-plugin.1`、`.2`，以及各自不可变的归档SHA-256。既有标签、包及验收记录不覆盖。安装来源必须包含不同构建身份或哈希路径，不能把新包覆盖到曾被包管理器缓存的同一个本地文件路径再假定更新成功；应逐文件或哈希核验实际安装。

该方案针对当前GitHub `.tgz`交付。npm registry不允许重发同版本；如果未来增加npm registry发布，必须先单独决定独立包修订的版本方案，不能绕开不可变发布规则。

## 一次性迁移

已装0.30.0的用户须明确安装新`0.2.1-rc.3.tgz`包并重启，不能依赖SemVer自动发现“更高版本”。原0.30.0发布保留作历史，新README始终链接当前构建。原有知识、员工/团队、工作流及会话历史保持。

## English

The plugin package version exactly matches the officially verified DSH version, including prerelease identifiers. The 0.30.0 to 0.2.1-rc.3 change renumbers the same functional baseline. Build/prepack guards require aligned package, engine, DSH peer, baseline and root-lock versions; they do not establish runtime compatibility.

Independent plugin fixes for an unchanged host retain the package version and use immutable GitHub build tags plus checksums and distinct installation sources. This is a GitHub tarball distribution policy, not permission to overwrite an npm registry version. Historical releases retain their original identity. Future host versions require fresh official-release verification.
