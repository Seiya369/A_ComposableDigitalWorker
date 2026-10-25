# 图谱节点面积调整验收记录（2026-10-24）

本记录对应 `dsh-plugin-composable-workforce@0.5.1`：仅将所有知识图谱节点的面积统一调整为 0.5.0 的一半，保留节点间的相对大小比例。严格增量编纂、四类认知记忆、引用证据及数据隔离规则不变。

被测归档：`artifacts/dsh-plugin-composable-workforce-0.5.1.tgz`，882,304 字节、281 个文件，SHA-256：

```text
10cb8e145850977d636e9a238daef073ef2af30f35e7b521e79cc9d4ff1b7b65
```

## 调整与尺寸核对

原有度数、最大度数和图谱密度决定的尺寸函数统一乘以 `Math.SQRT1_2`，即半径约为原来的 70.71%，圆面积为原来的 50%。所有节点使用同一缩放因子，实体／概念／来源／文章／概览之间原有的相对比例保持不变。Sigma 和 SVG 备用画布共用同一尺寸结果；未更改连线、字号、颜色或布局规则。

直接尺寸核对覆盖 4 种图规模（22、150、600、2000）和 4 种度数（0、1、5、20），共 16 档。半径比为 `0.7071067811865476`、面积比为 `0.5`，容差 `1e-12`；[尺寸核对结果](../artifacts/node-size-area-check.json)。没有为这一可逆样式调整新建镜像单元测试，也没有增加生产诊断属性。

## 实际归档验收

```sh
WORKFORCE_UI_ARCHIVE=artifacts/dsh-plugin-composable-workforce-0.5.1.tgz node tests/ui/employee-settings.e2e.mjs
```

浏览器使用原有 27 项验收，在官方 DSH 独立临时 profile 物理展开此归档，离线模型夹具真实接收原生模型调用。检查保留四类紧凑界面、重复上传和无变化重试零调用、独立新增仅发送变化资料、独立删除撤销派生知识、原有 B/C／概念原样保留，以及图谱交互、同屏文章阅读、空间隔离和进程清理。

| 检查 | 最终结果 |
| --- | --- |
| 尺寸核对 | 16／16 档通过，面积比 0.5，半径比 `sqrt(0.5)` |
| 物理归档浏览器 | 27／27 通过，退出码 0；[结果](../artifacts/node-size-validation/0.5.1-e2e-result.json)、[日志](../artifacts/node-size-validation/e2e.log)中的归档 SHA 与本记录一致 |
| 官方生命周期 | 13 项通过，安装／普通卸载／重装／完全清理均通过；[报告](../artifacts/lifecycle-0.5.1/report.json) |
| 官方宿主保护 | 28,401 个程序文件，前后联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003` |
| 当前本地服务 | 3081 已更新，状态 ready，知识快照仍为 v3，来源与知识逐对象一致；[实际证据](../artifacts/ui/node-size-live-result.json) |

已目视对比同尺寸的 [0.5.0 图谱](../artifacts/node-size-validation/0.5.0-knowledge-dark.png)与 [0.5.1 图谱](../artifacts/node-size-validation/0.5.1-knowledge-dark.png)：各类圆点统一缩小，原有相对大小保留，颜色和标签未变。[同屏文章阅读](../artifacts/node-size-validation/0.5.1-wiki-article.png)及[实际员工资料界面](../artifacts/ui/node-size-live.jpg)也已目视检查。

原 27 项中的增量行为继续通过：相同原件重复上传 0 次模型调用、无变化重新整理 0 次、独立新增只发送新来源全文且调用 2 次、独立删除 0 次并撤销对应派生知识。图谱缩放、真实平移与节点拖动保持可用。

本次为单一尺寸样式调整，沿用 [0.5.0 严格增量验收](verification-incremental-knowledge-2026-10-24.md)已通过的 414 项单元测试记录，未重复执行全套或新增镜像单测。宿主兼容验证范围仍为官方 `0.2.1-alpha.2`。
