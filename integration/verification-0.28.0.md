# 0.28.0 归档验收 / Archive acceptance

- 归档：`dsh-plugin-composable-workforce-0.28.0.tgz`
- 大小：1,102,417 bytes
- SHA-256：`ca7424a8d0c22fdf8c887706f07426cc3c627af05da01481143478cba9a95a0a`
- 官方宿主：DSH `0.2.1-rc.3`，提交 `1f81c047fc48fa190a683e469daa699857e9afe8`。
- 结果：**带保留项的预发布验收候选 / prerelease with documented exception**。

类型检查、构建通过；698 项测试中697通过、0失败、1项可选测试跳过。最终归档经过15项真实 Web 生命周期检查、29项 Web UI检查、真实 alpha.2 / 0.27.0 至 rc.3 / 0.28.0 的升级数据保留测试，以及官方 macOS arm64 Desktop 安装、保存、卸载、重装和专属清理。Web离线模型适配器用于可复现业务执行；Desktop未调用真实供应商模型执行任务。

Web宿主全部27,607个程序文件前后哈希：`4320efc9d117186946ef38cbf4078d44d4472de8f9ec42fc107db0b5923c64ac`。Desktop 6,437个程序文件前后哈希：`5d8aa4f92cee90fd89ce0991d69c3ff9d596db81e914da87fad6f49dedcf7a46`。均一致。

发布附件 `verification-0.28.0.json` 保存脱敏检查明细、性能样本统计与上游公告。完整分析、根因、修复步骤和后续建议见[兼容审计](../docs/audits/2026-10-26-dsh-desktop.md)。

原生会话持久记录没有官方删除 API，无法满足所有专属持久记录清除要求；不得称为无保留合规成品。官方依赖树发现6份独立公告，传播为196项节点告警；功能通过不等于安全无漏洞。未修改宿主依赖。Windows、其他架构与真实供应商长任务未验证。

The exact archive above passes typecheck/build, 697 automated tests (one optional test skipped), 15 Web lifecycle checks, 29 native Web UI checks, a real cross-version upgrade preserving user definitions, and real macOS arm64 Desktop installation/save/removal/restoration/plugin-owned cleanup. Program hashes are unchanged. Native session persistence cannot be deleted through upstream public APIs, and upstream dependency advisories remain disclosed; this is a prerelease candidate with that exception. Detailed evidence accompanies the GitHub release.
