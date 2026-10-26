# 0.2.1 / plugin.5 验收记录

日期：2026-10-26。官方 DSH **0.2.1-rc.3**，macOS arm64，Node v24.21.0。源提交 `37c93be47973bde0eff4c51f290ff58f9305f322`；包版本保持 `0.2.1`，构建标签 `v0.2.1-plugin.5`。

- 归档：`dsh-plugin-composable-workforce-0.2.1.tgz`
- SHA-256：`8c4d34f8ee68e5a999448e678cb4ea375b7ce238242a88d4620e601ac4cae138`
- 大小：1,291,987 bytes；407 文件、146 源码文件。

## 根因与修复

实际 Desktop 上，原生标签的鼠标坐标点击正常；员工按钮可见文字和箭头的鼠标点击无响应，AX 语义点击却能展开。原实现将按钮向下绝对定位，超出标题行插槽自身的几何区域，视觉区域与原生命中边界不一致。普通浏览器在正常窗口没有复现同一故障，不能仅凭浏览器定位器点击成功判断 Desktop 已正常；另在240px高窗口确认弹层被原生输入区覆盖。

修复保留官方 header.utilities 中的插件自有测量占位，把真正按钮与菜单分别放入 body 的紧尺寸固定 portal，明确各自 no-drag，仅覆盖可见控件区域；不覆盖整窗，不修改原生组件、标题栏、全局样式或宿主程序。菜单避开标题栏，隐藏/保留的原生会话会同步隐藏 portal，卸载注销全部观察器和事件。

鼠标悬停只高亮，不再调用 scrollIntoView 使祖先或选项移动；展开与键盘导航只调整员工列表自己的 scrollTop。默认文字、简洁姓名列表、常驻及本轮 @ 行为保持。

## 最终复测

| 验证 | 结果 |
| --- | --- |
| 单元测试 | 884 总计，883 通过，0 失败，1 项可选私有克隆跳过 |
| TypeScript / 构建 / 独立解包版本检查 | 通过 |
| 坐标命中矩阵 | 180/180，DPR1/2及四档窗口 |
| 官方常驻/隐藏面板 | 9/9 |
| 官方临时 @ /旧交付 | 8/8 |
| 官方项目工作流 | 31/31 |
| 干净 profile 安装/使用/卸载/重装/完整清理及原生功能 | 15/15 |
| Web / Desktop 安装文件 | 各407/407与归档逐字节相同 |
| 原有状态、全部定义 | 两端哈希原样 |
| 不可变知识版本 | Web68、Desktop134，改写0、新增0 |
| 三份宿主程序树 | 6,437 / 27,607 / 63,618 文件哈希原样 |

实际 Desktop 最终归档复测使用修复前相同屏幕坐标（2560×1640截图）：文字 `2250,120` 与箭头 `2358,120` 均能展开，Escape关闭，“无”行右边缘 `2488,202` 正确关闭且未写入绑定。未发送用户业务问题或改变用户员工选择。

浏览器矩阵覆盖1512×1050、1024×768、768×600、1512×240以及DPR1/2，验证文字、箭头、按钮边缘、行中心与边缘。原极矮视口的20个输入区截获异常已消失；鼠标悬停列表不位移，End仅滚动列表。切换到插件主面板后浮动入口隐藏，返回原会话恢复。

归档无用户数据、凭据、本机路径依赖、测试夹具、宿主构建或补丁。业务与缓存逻辑未修改，测试模型响应均为离线夹具，外部模型调用0。源码只规避有问题的原生祖先边界，不宣称已定位或修改Electron内部拖动算法；物理会话删除任务仍按ADR-004结项。

## English

This build fixes the employee selector's visible pointer targets in Desktop. An official header-slot seat measures position; the actual button and popup use two small fixed, plugin-owned body portals with explicit no-drag regions. Native components and program files remain unchanged. Hover no longer scrolls ancestors, keyboard navigation scrolls only the list, and hidden retained panels release their floating UI.

All 884 unit tests completed with 883 passes, zero failures and one optional skip. The final archive passed 180 coordinate cases, 9+8+31 official UI checks and 15 lifecycle checks. The original failing physical coordinates now work in the actual Desktop app. Installed files, user definitions/knowledge and official program hashes are verified unchanged except for this plugin's installation. Business, context/cache and model behavior remain intact.
