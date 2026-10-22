# 05: 可复现 CI、PR 证据与授权交付

**What to build:** 使用通用 CI 技能建立可复现质量检查，按 PR 技能准备说明和证据；仅在范围与授权明确后用 gstack 合并部署，最后记录环境与检查机制改进。

**Blocked by:** 04 独立审查与插件整体验收（发布候选）；CI 开发依赖探查可提前只读进行。

**Status:** local delivery complete; draft PRs #1/#2 published with explicit authorization; remote CI in progress; no merge or profile upgrade authorized

- [x] CI 使用官方发行包和项目声明，不依赖本机兄弟 Harness 源码；保留类型、测试、构建、归档及必要生命周期门。
- [x] 按 pr 模板提供前后证据、规格与依赖；本次增量和未提交基础差异分开。
- [ ] 远端 CI 结果与候选提交绑定；失败不跳过。基础与增量按两份草稿 PR 分开，最终候选检查通过后记录其精确提交；此次不合 main 或升级当前 profile。
- [x] 按 gstack 探查实际 PR/部署条件；最终说明哪些通过、未执行及原因。
- [x] 轻量 retro 提出可执行导航/自动检查改进，不堆叠泛化规则。
