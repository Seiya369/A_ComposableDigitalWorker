# 六岗位技能与工作树收尾验收

归档：dsh-plugin-composable-workforce-0.16.0.tgz

SHA-256：`8d980000a0ee33f6217d954918c12c3c0168db344239d6d225d469f44a624bf3`

交付：[插件包](../artifacts/dsh-plugin-composable-workforce-0.16.0.tgz)、[校验和](../artifacts/dsh-plugin-composable-workforce-0.16.0.tgz.sha256)、[安装及卸载说明](README.md)、[技能预设与工作树规则](../docs/architecture/software-role-skills.md)。兼容范围仍为已验证官方DSH 0.2.1-alpha.2；许可与来源说明随包提供。

## 实际结果

22项技能通过官方原生服务注册，模型可发现和加载；六位自由职业人各1个岗位必备技能，优先技能按场景选择。QA的code-review检查测试真实性、覆盖与契约，技术负责人检查生产实现与架构，两者均不能代替实际执行和授权验收。旧架构技能已清除过期工具指令。未装入重复调度整套团队的implement-spec，设计体系使用明确独立的轻量design-system-guidance，没有冒充上游搜索库。

当前状态修订 82 → 88；六位职业人只更新技能引用，模型、职责、知识、权限及其他模块保持。团队、已有项目实例、记忆、任务、工作流及运行均未修改，也未启动模型任务。[数据完整性](../artifacts/role-skills-validation/live-state-integrity.json)。

工作树遵循创建登记、合并核验、单目标移除、物理路径/列表/专属Git目录三重复核。工具只处理helper实际创建且本任务拥有的树；默认保护ignored，明确允许的可再生依赖/构建目录才清除。未合并、脏文件、他人树、越界链接、隐藏索引及嵌套或裸仓均阻断并报告。技能要求完成清理才算收尾；没有增加后台任意清理宿主或历史工作树的机制。Squash缺少祖先证明时先保全并明确处理。

## 验证

- [完整测试](../artifacts/role-skills-validation/all-tests.log)：511项通过；[重点测试](../artifacts/role-skills-validation/targeted-tests.log)：12项通过，包含10项真实隔离Git行为测试；[22项官方技能格式验证](../artifacts/role-skills-validation/skill-format.json)。
- [类型检查](../artifacts/role-skills-validation/typecheck.log)与[构建](../artifacts/role-skills-validation/build.log)通过。
- [实包界面检查](../artifacts/role-skills-validation/ui/report.json)：15项通过，覆盖六角色必备/优先均可用及导出保持，连同工作流、尺寸与主题回归；无模型请求。[实际QA界面](../artifacts/role-skills-validation/live-cua-verification.json)显示quality-verification和code-review且无不可用项、没有未保存内容。
- [官方独立profile生命周期](../artifacts/lifecycle-0.16.0/report.json)：14项通过，包括22技能及资源安装、原生功能、普通卸载、重装和完全清理。宿主28401文件前后哈希一致：`401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。
- [包清单](../artifacts/role-skills-validation/package-inventory.json)：333个文件全部与审查源及构建物逐字节一致，无宿主补丁、用户数据、凭据、机器路径依赖或测试夹具。
- [独立审查与修正说明](../artifacts/role-skills-validation/test-notes.md)、[绑定实包哈希的验收结果](../artifacts/role-skills-validation/acceptance.json)。本轮隔离测试目录已清理；没有新建留置的实际项目工作树。

![实际测试负责人技能](../artifacts/role-skills-validation/live-qa.jpg)
