# 分组知识图谱验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.8.0` 的最终物理归档。升级在同一张二维画布中紧凑展示真实语义分组，保留概念到 B 知识重组文章、精确 A 资料的连续阅读。分组边界是视觉装饰，不是知识节点或语义关系。

## 交付归档

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.8.0.tgz](../artifacts/dsh-plugin-composable-workforce-0.8.0.tgz) |
| SHA-256 | `83dca37e8aec33623438eb56d5dc60310127d035accdd8157fc3757cfedf309e` |
| 校验文件 | [归档 SHA-256](../artifacts/dsh-plugin-composable-workforce-0.8.0.tgz.sha256) |
| 大小／文件数 | 898,679 字节／287 个文件 |
| 兼容验证 | 官方 DSH `0.2.1-alpha.2`，Node `24.21.0`，独立临时 profile |
| 安装、卸载、完整清理 | 随包 [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

## 行为与边界

- 主图继续仅包含知识重组后发布的概念／实体及有依据的语义关系。文章、来源、概览继续可读，但不作为主图节点，不因共现、共用来源或主题相同而补边。
- 按真实连通分量确定分组，组内沿真实关系布局，分组之间紧凑排列；保留孤立概念。分组名称来自组内真实概念，视觉边界不增加节点、关系或度数，不改变原社区计算。
- 点击节点只突出真实一跳邻居及关联谓词；无关知识保留并弱化。打开关联 B 文章与精确 A 原文时保留原图谱焦点，可返回概念或定位图谱。
- 搜索输入过滤知识，Enter 打开并定位匹配概念，同时保留其真实一跳上下文；“全部知识”清除筛选、阅读栏和选中状态，并恢复全图相机。
- Sigma 与 SVG 降级显示使用同一语义布局与焦点规则，支持缩放、平移、节点拖动及键盘操作。节点标签及悬停文字按可用空间自动左置／右置，极长名称省略，防止越过画布；完整名称保留在阅读和无障碍入口。
- 编纂规则新增当前增量范围内的关系复核：仅检查本次资料、必要摘录和已提供相关概念中可证明的明确／推断关系。推断保留依据与不确定性；不要求图谱连通，不扩大到全库重新编纂，也不重写无关知识。
- 未修改增量触发、归档频率、四类目录、归档开关或节点大小公式。本次现有库升级未调用模型，也未重新编纂 A/B/C。

## 验证结果

| 验证 | 结果与证据 |
| --- | --- |
| 构建与类型检查 | `npm run build`、`npm run typecheck` 通过；[构建日志](../artifacts/grouped-graph-validation/build.log)、[类型日志](../artifacts/grouped-graph-validation/typecheck.log)；Web 独立 TypeScript 检查通过 |
| 全量单元 | **465／465**；包含新增的确定性分组、孤立节点、无虚构边、图不可变性及真实一跳边界回归；[结果](../artifacts/grouped-graph-validation/unit-result.json)、[日志](../artifacts/grouped-graph-validation/unit.log) |
| 最终归档浏览器 | **40 项通过**，Chrome `155.0.8059.85`，干净官方宿主与独立 profile，离线模型；[结果](../artifacts/grouped-graph-validation/employee-settings-result.json)、[归档绑定](../artifacts/grouped-graph-validation/ui-archive-binding.json)、[日志](../artifacts/grouped-graph-validation/ui-e2e.log) |
| 分组与连续阅读 | 7 个阅读页面仅形成 4 个语义节点／2 条关系／2 组；分组无合成桥，真实一跳高亮，B／精确 A 阅读保留焦点，搜索改变实际相机，全部知识恢复筛选与默认相机 |
| 边界与隔离 | 2 个孤立概念不补边，语义图不受阅读页数量影响；3 个空间复用同一进程，来源隔离，关闭后无进程残留；本轮阅读与交互零模型调用且快照不变 |
| 图形降级与文字边界 | 真实 Chrome WebGL 故障注入与 SVG 操作通过，正常 WebGL 及悬停中文标签边界专项通过；[SVG 结果](../artifacts/grouped-graph-validation/fallback-result.json)、[正常标签结果](../artifacts/grouped-graph-validation/native-label-result.json) |
| 官方安装生命周期 | **13／13**，安装、使用、普通卸载、重装、宿主原生功能、完整清理通过；12 个知识文件在普通卸载与重装前后逐字节一致；[正式报告](../artifacts/lifecycle-0.8.0/report.json) |
| 官方程序未变 | 前后 **28,401** 个程序文件的完整联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003` |
| 归档白名单 | **287 个文件**与源码／构建逐字节一致，不含宿主补丁／构建、node_modules、用户数据、凭据或测试夹具；[核对结果](../artifacts/grouped-graph-package-inventory.json) |

首轮隔离浏览器在长 B 文章底部来源按钮上的鼠标事件未触达目标。该处回归改为真实键盘聚焦与 Enter，保留原文及精确行内容断言；概念和关系来源仍保留鼠标检查，实际 3081 CUA 点击 B 文章来源也成功。首轮失败证据保留在验证目录。之后修正 SVG 字号及画布边缘文字排布，每次均重新打包并执行完整归档 UI 与生命周期验证；正式报告均绑定本记录的 `83dca37e…edf309e`，早期候选报告单独备份。

## 实际 3081 数据

- 架构师快照仍为 **v3**，保留 **15 个概念、10 条语义关系、22 篇阅读页面**，实际形成 **5 个连通分量**。当前关系已完整进入主图，没有被显示层漏画。
- 原始资料、快照、归档策略、阅读页面与升级前逐项一致；知识根除派生 Wiki 缓存与写锁外 **51 个文件逐字节一致**。本次新建升级基线，不能沿用上次 47 个文件的旧基线。
- 5 组分别为事实／依据、推断／不确定性、项目决定／确认与交付、源文件变化／重新核验、架构工作方法／验收与表达。要形成一个连通网络仍须后续资料提供有依据的跨组关系；本次展示优化不会制造这类关系。
- CUA 验证真实页面的概念 → B 全文 → 鼠标点击 A 精确原文 → 返回概念，图谱焦点保持；搜索 Enter 改变相机，全部知识恢复 15 个节点及默认相机。

实际证据：[数据完整性](../artifacts/grouped-graph-validation/live-upgrade-integrity.json)、[关系分量核对](../artifacts/grouped-graph-validation/live-semantic-components.json)、[CUA 交互](../artifacts/grouped-graph-validation/live-cua-result.json)、[实际分组总览](../artifacts/grouped-graph-validation/real-v3-grouped-overview.png)、[原文与图谱上下文](../artifacts/grouped-graph-validation/real-v3-source-context.png)。

极矮画布可因标签碰撞隐藏部分文字，分组包络也可能重叠；节点、缩放和阅读操作仍可用。完整名称可从知识阅读和键盘节点获取。验收不声称任意尺寸下同时展示全部标签。

验收绑定以上最终物理归档与哈希，验收后未重新打包；未修改官方宿主文件。
