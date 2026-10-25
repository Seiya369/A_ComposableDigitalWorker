# 紧凑员工列表验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.9.3` 最终物理归档。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.9.3.tgz](../artifacts/dsh-plugin-composable-workforce-0.9.3.tgz) |
| SHA-256 | `d0a020fb3e5b5844f0d6dd95bc1337c1d77f2ccff38a72704f6b299f9b3d7da8` |
| 校验文件 | [SHA-256](../artifacts/dsh-plugin-composable-workforce-0.9.3.tgz.sha256) |
| 大小／文件数 | 908,449 字节／291 个文件 |
| 环境 | 官方 DSH `0.2.1-alpha.2`、Node `24.21.0`，独立临时 profile |
| 安装、卸载、许可 | [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

员工库和旧入口的未分组员工按钮直接复用团队成员的 `.wf-team-nav-member` 样式，只显示 14px 人形图标及单行姓名；移除头像框、第二行草稿／版本和状态圆点。行高至少 32px、内边距 5px／8px，长姓名单行省略并提供完整姓名悬停提示。没有新增第二套样式或改变点击、搜索、选择、默认模型页及保存逻辑；员工版本和状态数据仍完整保留。

## 已验证边界

- `npm run build`、`npm run typecheck` 通过：[构建日志](../artifacts/employee-list-validation/build.log)、[类型日志](../artifacts/employee-list-validation/typecheck.log)。本次为展示标记变更，不重复运行全量业务单元测试。
- 最终实包 **52 项 UI 检查全部通过**，两位测试员工均为 32px、单行、14px 图标，无头像框和第二行状态；与真实团队成员的字体、行高、内边距、间距、圆角、省略及图标逐项一致。原默认模型页、AI 智填、归档、灰色和图谱检查全部保留：[结果](../artifacts/employee-list-validation/employee-settings-result.json)、[归档绑定](../artifacts/employee-list-validation/ui-archive-binding.json)、[日志](../artifacts/employee-list-validation/ui-e2e.log)、[员工列表截图](../artifacts/employee-list-validation/employee-list-compact-desktop.png)、[团队参考截图](../artifacts/employee-list-validation/employee-list-team-reference.png)。临时浏览器、宿主、Wiki 子进程及 profile 均已清理。
- 最终实包 **13 项官方生命周期检查通过**，安装、普通卸载、重装、完全清理及原生宿主恢复通过；12 个知识文件普通卸载重装前后逐字节一致：[报告](../artifacts/lifecycle-0.9.3/report.json)、[日志](../artifacts/lifecycle-0.9.3/lifecycle.log)。生命周期临时宿主、Wiki 子进程及 profile 均已清理。
- 官方宿主 **28,401 个程序文件**前后完整联合 SHA-256 一致：`401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。未修改官方宿主文件。
- 归档 **291 个文件**与源码／构建逐字节一致，不含宿主补丁、用户数据、凭据或测试夹具：[白名单核对](../artifacts/employee-list-package-inventory.json)。
- 当前 3081 的六位员工实际行高约 **31.997px**，与六位团队成员一致；字体、内边距、圆角、单行省略及图标尺寸一致，头像框及第二行状态均为零。返回员工库后仍默认模型页，完整员工状态与本次新建基线一致，未修改／保存配置或调用模型：[实际样式对比](../artifacts/employee-list-validation/live-cua-result.json)、[状态完整性](../artifacts/employee-list-validation/live-state-integrity.json)、[实际截图](../artifacts/employee-list-validation/live-compact-employees.png)。

首次新增的单行检查将中英混排同一行的多个 Range 矩形片段误当成多行。仅修正测试按实际行高聚合垂直行，保留片段数以及全部尺寸、结构和团队对比断言；产品和归档未变，完整重跑通过。首轮证据及说明见 [迭代记录](../artifacts/employee-list-validation/test-iteration-notes.md)。

所有正式报告绑定以上最终归档与哈希，验收后未重新打包；历史验收记录保留。
