# 认知分类字号与开关尺寸验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.6.1`，仅调整认知记忆分类栏样式。

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.6.1.tgz](../artifacts/dsh-plugin-composable-workforce-0.6.1.tgz) |
| SHA-256 | `77292fbd9d5ea863e013eccc6efea06bdaf7f79422587e0c755ebac773c22c43` |
| 大小／文件数 | 899,029 字节／285 个文件 |
| 兼容验证 | 官方 DSH `0.2.1-alpha.2`，独立临时 profile |
| 安装卸载／许可 | 随包 [说明](README.md)、许可证、固定共享 Wiki 源码和构建依赖锁 |

分类名称原实际计算字号为 12px，归档按钮因通用按钮字体继承而实际为 14px。本次交换成四个名称 14px、三个归档提示 12px，并使用更具体的选择器保证结果。开关整体保持比例缩至 0.7 倍，高度 16→11.2px、宽度 26→18.2px；按钮点击区域保持。上传资料操作、开关保存与图谱行为不变。

## 验证

- 构建通过；现有物理归档浏览器验收 30／30，通过宽屏、窄屏和短窗口的真实计算字号／开关高度断言；[结果](../artifacts/archive-style-validation/employee-settings-result.json)、[日志](../artifacts/archive-style-validation/e2e.log)。
- 实际 3081 服务读取到四个名称均为 14px、三个提示均为 12px、开关高度约 11.198px（浏览器亚像素舍入）；[实际计算值](../artifacts/ui/archive-style-live-metrics.json)、[截图](../artifacts/ui/archive-style-live.jpg)。
- 官方独立 profile 安装、使用、普通卸载、重装及完全清理等 13 项检查通过；知识目录重装前后 12 个文件逐字节一致；[生命周期报告](../artifacts/lifecycle-0.6.1/report.json)。
- 官方程序 28,401 个文件前后联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003`。
- 当前服务原知识快照仍为 v3，来源身份／版本／内容哈希及归档设置逐对象一致；[结果](../artifacts/ui/archive-style-live-result.json)。
- 包白名单检查通过，不含宿主补丁、宿主构建物、安装目录、用户数据、凭据或测试夹具；[包内容核对](../artifacts/archive-style-package-inventory.json)。

本次仅低影响样式变更，沿用 [0.6.0](verification-archive-controls-2026-10-24.md) 的全量单元结果，不新写 CSS 镜像单元测试。

## 节点缩放核查

本次未修改节点渲染。当前正常 Sigma 3.0.2 渲染使用屏幕尺寸参照及默认平方根衰减，屏幕半径为基准半径除以相机比例的平方根；视野放大 2 倍，半径增为约 1.414 倍。平移不改变半径；选中／悬停另有强调倍数。已核对本地实际 Sigma 源码和归档内共享网页构建。

无 WebGL 的 SVG 备用视图是静态备用，圆点随容器尺寸变化，当前不支持自身滚轮／按钮相机缩放。现有浏览器检查验证正常渲染的相机缩放，不将其冒称为节点像素半径测量。
