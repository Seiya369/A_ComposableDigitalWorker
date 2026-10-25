# 软件开发岗位技能

本插件随包提供22项可供模型调用的技能，通过官方 `ctx.skills.register` 发布，目录基于真实前言描述。前言标识与目录不一致、内容缺失、YAML损坏或禁止模型调用时拒绝加载。技能正文只在使用时读取，必备技能每份工作单加载一次，优先技能匹配任务时通过原生技能工具加载。

这些是为当前DSH团队工作流独立编写的简洁岗位方法，不要求Codex专有工具、另一套多代理调度或工单系统。保持岗位、任务授权与原生策略边界；没有复制或修改用户全局Skill。技能资源只保存一份，员工配置只引用稳定ID。配置不会因技能存在而自动授予权限或安装MCP。

## 六岗位配置

预设源文件：`skills/software-development-presets.json`。全新 profile 的默认六岗位直接消费该预设源，由 `src/domain/software-defaults.ts` 生成完整岗位、认知与记忆规范、团队及两条工作流；不是只提供可选择的技能目录。升级安装本身不静默迁移已有用户配置，既有项目员工、工作流运行和团队快照保持冻结；后续引入使用更新配置。

| 岗位 | 必备 | 优先 |
|---|---|---|
| 产品负责人 | requirements-acceptance | grill-with-docs、to-spec |
| 技术负责人/架构师 | architecture-design | architecture-analysis、to-tickets、code-review、technical-review、retro、worktree-cleanup |
| UX/UI设计师 | ux-design-review | frontend-ui-engineering、design-system-guidance |
| 开发人员 | incremental-implementation | test-driven-development、debugging-and-error-recovery、pr、worktree-cleanup |
| 测试负责人 | quality-verification | code-review、webapp-testing、worktree-cleanup |
| 运维负责人 | release-readiness | shipping-and-launch、ci-cd-and-automation、worktree-cleanup |

技术负责人审查生产实现、架构及边界；测试负责人交叉审查测试断言、需求覆盖、契约和遗漏风险，复用相同版本及已有评审证据。代码审查与实际测试执行分别记录，不以阅读代码宣称通过。`pr` 只整理说明稿；`retro` 在阶段结束或重复问题时提供工程改进建议，与插件认知记忆的经验归档不同。没有装入会自行调度整套团队的 `implement-spec`。`design-system-guidance` 是轻量设计规范指导，不冒充包含上游 `ui-ux-pro-max` 的数据与搜索程序。

## 工作树必须收尾

不为每份任务强制创建工作树。确需隔离时，记录本任务归属、路径、创建提交及集成目标，停止临时进程；合并并核验后必须清理物理checkout、允许清除的可再生依赖构建物及其专属Git管理记录。收尾失败列出路径、原因和保全状态，不能把仅合并提交报告成完整收尾。

`worktree-cleanup` 的零依赖Node工具位于它自己的资源目录，只接受明确的主仓库、单个临时路径、任务owner和本地集成分支。`create` 实际创建工作树并记录归属，不接受事后认领；`audit` 只读；`cleanup` 复核祖先合并关系及干净状态后调用原生 `git worktree remove`，不使用force或批量prune。详细参数以技能及helper `--help` 为准。

未合并提交、tracked/staged修改、未跟踪或未声明ignored文件、隐藏索引标志、锁定、主树、他人目录、越界符号链接及嵌套/裸Git仓库都会阻断清理。只有创建时明确登记为可重新生成、整体ignored且不含用户成果的允许依赖构建根目录才被移除。默认保护ignored内容；不扫描删除旧工作树。Squash/cherry-pick不能仅由祖先关系证明已合并时，先保全并核验成果，再明确处理，不重置HEAD伪造核验。临时分支及共享Git历史不在清理范围。

平台管理的工作树使用原平台归属与移除入口，不能绕过平台直接删除。卸载插件只停止技能注册及插件工作，保留用户仓库和未收尾工作树；这些目录仍属于用户成果，不能随插件完全清理而盲删。

## 安装与验证

技能与脚本随npm包安装，升级后重启/刷新DSH，从能力组合目录选用；卸载后注册和插件入口停止，不遗留全局技能副本。兼容版本、安装和完全清理见安装说明。

隔离Git行为测试证明允许的工作树物理路径、列表项及专属管理目录均消失，同时阻断有独占数据的目标；官方原生技能注册测试覆盖22项模型可调用、六岗位引用、资源定位及插件卸载后其他技能仍存在。实包官方临时profile检验安装和卸载，实际六人修改通过原有API版本校验，不启动真实模型任务。
