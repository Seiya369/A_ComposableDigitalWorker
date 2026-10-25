# 知识图谱工具栏验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.8.1` 的最终物理归档。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.8.1.tgz](../artifacts/dsh-plugin-composable-workforce-0.8.1.tgz) |
| SHA-256 | `d14ab06ee3e7e8f13e459ce65eaba1d3b1708e84b5fc5fb8b4f336b48e91073c` |
| 校验文件 | [归档 SHA-256](../artifacts/dsh-plugin-composable-workforce-0.8.1.tgz.sha256) |
| 大小／文件数 | 899,147 字节／287 个文件 |
| 兼容验证 | 官方 DSH `0.2.1-alpha.2`，Node `24.21.0`，独立临时 profile |
| 安装与卸载 | 随包 [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

## 修改结果

- 删除顶部“文章”按钮。已有图谱从概念进入 B 知识重组正文与精确 A 原文；不增加替代的顶部入口。旧快照没有语义节点但已有 B 文章时，空间／版本初始化自动打开只读目录，继续支持概览、文章与来源阅读，关闭按钮可正常关闭。
- 将“社区”改为“知识分组”，默认使用已有语义关系的社区聚合结果着色；切换知识空间或快照恢复该默认状态。“分组”只是知识关系的聚合显示，不新增节点或关系。
- 将“类型”改为“节点类别”，继续区分概念与实体，而不是把实体也显示为概念。对应图例及无障碍名称同步更新。
- 未修改编纂规则、更新频率、节点大小、图谱关系或知识文件。本次显示升级零模型调用。

## 验证

| 验证 | 结果与证据 |
| --- | --- |
| 构建与类型 | 构建、根 TypeScript、Web 独立 TypeScript 通过；[构建](../artifacts/graph-toolbar-validation/build.log)、[根类型](../artifacts/graph-toolbar-validation/typecheck.log)、[Web 类型](../artifacts/graph-toolbar-validation/web-typecheck.log) |
| 全量单元 | **465／465**；[结果](../artifacts/graph-toolbar-validation/unit-result.json)、[日志](../artifacts/graph-toolbar-validation/unit.log) |
| 最终实包浏览器 | **43 项通过**，Chrome `155.0.8059.85`，独立官方宿主与离线模型；覆盖旧入口删除、默认分组、双向切换员工后恢复默认、概念／实体筛选、空图目录和已有图谱的 B／精确 A 阅读、焦点、缩放／平移／拖动、深浅色及窄矮窗；[结果](../artifacts/graph-toolbar-validation/employee-settings-result.json)、[包绑定](../artifacts/graph-toolbar-validation/ui-archive-binding.json)、[日志](../artifacts/graph-toolbar-validation/ui-e2e.log) |
| 官方生命周期 | **13／13**，安装、使用、普通卸载、重装、原生宿主恢复及完全清理通过；12 个知识文件在卸载重装前后逐字节一致；[报告](../artifacts/lifecycle-0.8.1/report.json) |
| 官方宿主未变 | 前后 **28,401** 个程序文件的完整联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003` |
| 归档白名单 | 287 个文件与源码／构建逐字节一致，无宿主补丁、宿主构建物、node_modules、用户数据、凭据或测试夹具；[核对](../artifacts/graph-toolbar-package-inventory.json) |
| 实际 3081 | v3 的 15 概念／10 关系／22 阅读页完全一致，51 个知识文件逐字节未变；[数据核对](../artifacts/graph-toolbar-validation/live-upgrade-integrity.json)；CUA 核对删除旧按钮、默认分组及类别切换，[实际交互](../artifacts/graph-toolbar-validation/live-cua-result.json) |

实际截图：[默认知识分组](../artifacts/graph-toolbar-validation/live-default-groups.png)、[节点类别](../artifacts/graph-toolbar-validation/live-node-categories.png)。

验收绑定以上最终归档与哈希，验收后未重新打包；不修改官方宿主文件。
