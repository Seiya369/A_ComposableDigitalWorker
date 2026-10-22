# 员工知识分类与投喂候选验收

日期：2026-10-22。状态：本地候选及官方原版隔离验收通过；远端 PR、CI、合并和用户 profile 升级未执行。

## 候选身份

- 增量基线：`8c549f5bb724ff5b07af48e2871115e06ac0f450`。独立保存的既有工作区，不等同于已合 main。
- 最终代码候选：`c069c8cedbdf040500311475d48f5d3fbd7b4a95`。
- 包：`dsh-plugin-composable-workforce-0.4.0.tgz`，260,244 字节，104 个文件。
- SHA-256：`5dff9abdd536be0359371083a87cf3974f5da98834a179ddc3e708222842e76a`。
- 实际环境：Node `v24.21.0`、官方 npm `@deepseek-ai/dsh@0.2.1-alpha.2`、Cordis `4.0.5`。31 个生产 peer 均精确匹配，realpath 均在独立官方安装内。
- 证据根：`artifacts/employee-knowledge-classification-2026-10-22/`；归档、SHA256SUMS、原始日志、JSON 和截图随本地交付保留。

## 已完成

| 边界 | 结果与证据 |
| --- | --- |
| TDD 与回归 | 352 通过、0 失败，见 `final-tests.log`。全套在 `2e8287b` 执行；后续仅共享类型别名、生命周期夹具及安装文档变化，最终 host/client 运行字节相同。最终 strict、脚本、构建及 parser 14 项验证通过 |
| 六类 A 与配置 | 真实目录、分类版本、活动/退役/孤立历史、损坏/链接/并发恢复；专业规则保存、交换与实例分离；见 `tdd/` 和对应公开边界测试 |
| 政策与读取 | 实际编纂请求接收员工有效政策；规则变化重编、旧结果不能发布；默认旧政策 B 隐藏，显式历史标过期；普通新增资料不终止运行 |
| 独立审查 | Standards：0 硬违例，1 类型重复提示已修正；Spec：0 问题。两轴补审均绑定最终候选，无待处理项，见 `reviews/` |
| 浏览器 | 六项四字标题与简短说明；PDF/DOCX/UTF-8 上传、部分失败、未保存草稿保持、重复 v1、刷新恢复列表、编纂配置折叠保留；0 JS 运行错误。见 `ui/feeding-acceptance.json` 和截图；最终 client SHA 与受验 UI 一致 |
| 归档 | 两次真实 npm pack 哈希相同；104 个文件逐一比对源字节；不含宿主补丁、源码、测试夹具、用户数据、凭据、node_modules 或 source map，见 `package/report.json` |
| 原版生命周期 | 同哈希归档通过官方 CLI 安装、认证功能和三种上传、关闭管理员、普通卸载、宿主原生运行、重装数据逐字节保持、完整 purge 与原生重启；见 `lifecycle/report.json`（passed=true） |
| 宿主未变 | 原版 28,780 文件前后总 SHA：`4884c5114baef30852d2985e267a86e4a1553b6d5f6a41e6fe0185370880b7f3`。用户成果、共享凭据夹具保留 |
| 原工作区 | 原 HEAD/index 及 177 个文件 preimage 全部未变；见 `original-workspace-preserved.json` |
| 依赖审计 | 插件 0 漏洞；原版宿主 12 中危、0 高危/严重，原始 JSON 保留。未修改宿主或自动 audit fix |

实际 pnpm 长路径失败另存 `lifecycle-initial-enametoolong.log`。最终验收把归档复制到临时短路径，先验证 SHA 完全一致，并保留到卸载、重装、purge 完成后才清理；官方依赖检查一直启用。

## 语义与能力边界

两组真实 Codex 合成编纂样例，15 B / 10 C，经独立上下文逐行核对 71 组主张和 59 个引用区间，0 语义失败，2 处元数据行级引用提示。见 `semantic/audit.json`。这是 Codex 代理的一次合成试验，未调用实际 DSH 负责人模型，不证明长期质量或逐命题事实自动核验。

原件和提取文本各限 1 MiB；Word 为 DOCX，PDF 最多 200 页；扫描 OCR、加密 PDF、旧 DOC、宏文档及复杂版面不支持。模型上下文不含原件 base64；后台编纂输入超限时 A 保留并报告待整理。32/48/64K 预算候选未切为运行默认值。

## 尚待授权的远端交付

远端私有仓库 main 仍为 `d0925993204da48a9c85920fab4a5b5e13fa2292`，没有本分支 PR 或 CI run。已准备通用 CI 工作流（Node 22.19.0/24.21.0）；远端矩阵尚未运行，不能称 CI 已通过。PR 草稿见 `.scratch/employee-knowledge-classification/pr-body.md`，轻量复盘见同目录 `retro.md`。

已执行 gstack `land-and-deploy` 的只读仓库/PR 预检，因没有 PR 停在合并前。该技能要求 “If no PR exists: STOP”。历史基线与本次增量需先明确发布范围，再建立可审查 PR、运行远端 CI，最后按其就绪门授权合并。当前未推送历史代码、未合 main、未发布 npm、未升级用户正在使用的 profile。
