# 员工知识分类任务图

状态：01–04、追加 06 已完成本地及官方原版验收；05 的远端发布/CI/合并待明确历史基线范围。规格见[员工 ABC 知识分类与专业编纂](../../docs/specs/employee-knowledge-classification.md)。

| 任务 | 交付行为 | 前置依赖 |
| --- | --- | --- |
| [01 六类 A 与历史兼容](issues/01-categorized-source-history.md) | 六类实体目录、准确归档、完整历史定位与可恢复转换 | 无 |
| [02 员工专业配置](issues/02-employee-organization-settings.md) | 来源类别、专业/任务分类与概念规则可编辑并交换 | 01 的来源分类契约 |
| [03 专业编纂与政策新鲜度](issues/03-policy-aware-compilation.md) | B/C 按有效政策编纂，规则变化重编，旧结果不发布 | 01、02 |
| [04 独立审查和整体验收](issues/04-independent-review-and-acceptance.md) | 双轴审查、Host/Web、浏览器与官方 profile 归档验收 | 03 |
| [06 六项界面与投喂](issues/06-feeding-upload.md) | 六个四字标题、PDF/DOCX/文本独立上传、原件与持久列表 | 01–03；用户追加授权 |
| [05 CI、PR、交付与复盘](issues/05-ci-delivery-and-retro.md) | 可复现检查、准确 PR 证据、授权合并交付及检查机制改进 | 04；只读 CI 研究可提前 |

已确认的测试边界是：岗位配置公开保存与交换；知识库公开入库/读取/发布及用户要求的布局；管理员编纂/任务准备和官方宿主生命周期。业务代码与测试按任务依赖实施。

基础依赖说明：远端 main 仅含初始化提交，旧工作区有大量尚未提交的 ABC 等实现；已在本地保存不可变基线并建立独立集成 worktree，原 checkout HEAD/index 不变。本次增量与基线分别审查，不能把基线自动认作已经合 main。

验收记录：`docs/verification/employee-knowledge-classification-2026-10-22.md`；本地 PR 草稿：`pr-body.md`；轻量复盘：`retro.md`。
