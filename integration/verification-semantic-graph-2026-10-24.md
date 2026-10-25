# 语义知识图谱修正验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.7.0` 的最终物理归档。主图按本项目产品要求显示知识重组后的概念／实体和有依据的语义关系；原上游 `llm_wiki@0.6.13` 的页面链接网络并不强制此规则。本次继续复用其固定版本的社区分析与分析提示，保留全部阅读页面。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.7.0.tgz](../artifacts/dsh-plugin-composable-workforce-0.7.0.tgz) |
| SHA-256 | `f904702c870abd75a596cf7e7fe14b089a38370b93c85b4da5d6bc3d4df00ca1` |
| 校验文件 | [归档 SHA-256](../artifacts/dsh-plugin-composable-workforce-0.7.0.tgz.sha256) |
| 大小／文件数 | 885,039 字节／285 个文件 |
| 兼容验证 | 官方 DSH `0.2.1-alpha.2`，Node `24.21.0`，独立临时 profile |
| 安装、卸载、完整清理 | 随包 [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

## 行为与边界

- 主图固定为 `graph.kind=semantic`，节点仅来自已发布快照的概念／实体。边仅来自快照的语义关系；页面链接、共用引用和概览导航不生成边。
- 同一对节点合并绘制一条边，完整保留各条有向谓词、原文明确／模型推断、关联 B 文章及精确 A 版本与行引用。统计按原始语义关系条数计算；大小、布局、社区不受阅读页面数量影响。无关系的概念保留为孤立节点。
- 文章、来源、概览继续进入独立阅读目录。概念可打开完整 B 文章和精确 A 原文；旧快照尚无概念图时主图为空，文章继续可读，不用文章标题造点或补线。
- 宿主对共享程序返回的全部阅读页身份、路径、正文、引用、导航及写盘 Markdown 核对本次 A/B/C；拒绝未知／遗漏页、串正文和路径碰撞。主图关系及度数另作严格核验。
- 仅重建派生 Wiki 投影，未重新编纂 A/B/C，未改变原有增量更新触发与自动归档规则。本次真实库转换为零模型调用。

## 验证结果

| 验证 | 结果与证据 |
| --- | --- |
| 构建与类型检查 | `npm run build`、`npm run typecheck` 通过；[构建日志](../artifacts/semantic-graph-validation/build.log)、[类型日志](../artifacts/semantic-graph-validation/typecheck.log) |
| 全量单元 | **459／459**；包含旧缓存转换、完整阅读页边界、关系证据、多个谓词及孤立节点；[结果](../artifacts/semantic-graph-validation/unit-result.json)、[日志](../artifacts/semantic-graph-validation/unit.log) |
| 最终归档浏览器 | **34 项通过**，Chrome `155.0.8059.85`，干净官方宿主与隔离 profile，使用仅测试所有的离线模型；[结果](../artifacts/semantic-graph-validation/employee-settings-result.json)、[日志](../artifacts/semantic-graph-validation/ui-e2e.log) |
| 语义与阅读 | 5 个阅读页面仅形成 2 个语义节点、1 条关系；全部 B/A/C 可读，2 个孤立概念不补边，增加无关阅读页不改变语义度数与社区 |
| 界面交互 | 搜索、类型／社区、缩放、平移、拖动、同屏阅读、精确来源、空图阅读、深浅色、窄屏与矮窗通过；3 个空间隔离使用同一共享进程，关闭后无进程残留 |
| 官方安装生命周期 | **13／13**；安装、使用、普通卸载、原生宿主、重装与完整清理通过；知识目录 12 个文件逐字节保留；[报告](../artifacts/lifecycle-0.7.0/report.json) |
| 官方程序未变 | 前后 **28,401** 个程序文件完整联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003` |
| 归档白名单 | 285 个归档文件与当前源码／构建逐字节一致，不含宿主补丁、宿主构建物、node_modules、用户数据、凭据或测试夹具；[核对结果](../artifacts/semantic-graph-package-inventory.json) |

首轮浏览器验收的图例鼠标输入未触达目标。冻结归档的独立沙箱鼠标对照在阅读栏开／关时均正常；对应回归改为真实键盘聚焦并按 Enter，继续验证按下状态与节点实际隐藏／恢复，未削弱断言。保留了[首轮记录](../artifacts/semantic-graph-validation/first-run-ui-failure.log)及[鼠标对照](../artifacts/semantic-graph-validation/legend-diagnostic.json)。生产代码与最终归档未因该测试调整改变。

## 实际 3081 数据与界面

- 技术负责人（架构师）的快照仍为 **v3**。旧主图 **22 点／61 线**修正为 **15 个概念／10 条语义关系**，22 个阅读页面的标题和正文逐项一致；[实际结果](../artifacts/semantic-graph-validation/real-v3-live-result.json)。
- 原始资料、知识快照、归档开关保持一致，知识根除派生 Wiki 缓存外的 **47 个文件逐字节未变**，清单联合摘要为 `d0f708b3cf3a9690b011258068c0a7f63457efdc510a18d40e10af3e626c181f`。
- CUA 实际点击核验：概念 → 完整 B → 精确 A；目录 → C 概览；带方向、谓词和依据的关系阅读；类型图例隐藏全部节点与关系后可恢复 15／10；[界面结果](../artifacts/semantic-graph-validation/real-v3-cua-result.json)。
- 截图：[实际主图](../artifacts/semantic-graph-validation/real-v3-semantic-graph.jpg)、[完整文章](../artifacts/semantic-graph-validation/real-v3-article.jpg)、[精确原文](../artifacts/semantic-graph-validation/real-v3-source.jpg)、[语义关系](../artifacts/semantic-graph-validation/real-v3-relation.jpg)、[概览阅读](../artifacts/semantic-graph-validation/real-v3-overview.jpg)。

验收绑定以上最终包与哈希，验收后未重新打包。社区算法可能存在多个合法分区；本进程缓存最多 16 份语义拓扑结果，重启或缓存淘汰后的社区编号不保证不变，详见[共享程序说明](../third_party/llm-wiki/README.md)。
