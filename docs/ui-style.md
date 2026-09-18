# 界面样式约定

数字员工界面沿用 DeepSeek Harness 设置页的字体、控件尺寸和主题语义。当前参考版本为 **0.1.1-rc.2**，兼容基线提交为 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；下方宿主源码链接指向相邻的 `../deepseek-harness` 检出目录。

## 主题与字体

宿主 [`ui-theme`](../../deepseek-harness/packages/client/ui-theme/src/styles/) 拥有浅色、深色和跟随系统的主题状态。插件在 [`workforce.css`](../src/ui/workforce.css) 的 `.wf-root` 中将本地变量映射到 `--dsw-alias-*`，组件不另设主题选择器或固定调色板。

字体使用 `--dsw-font-family`。正文与侧栏使用 `--dsw-font-s-14`（14/22），标签页使用 `--dsw-font-xs-13`（13/20），辅助信息使用 `--dsw-font-xxs-12`（12/18）。表单标签与控件按宿主插件设置页使用 13px、1.5 倍行高，由 `--wf-font-label` 与 `--wf-font-control` 统一定义；标签字重为 500。

页面标题由 `--wf-font-heading` 定义为 18px、字重 600，依据宿主插件设置标题；没有对应的 18px 字体 token。宿主 `--dsw-font-m-18` 实际为 16/28，不用于此标题。

## 控件与布局

| 对象 | 插件约定 | 宿主依据 |
| --- | --- | --- |
| 模态框 | 圆角 24，layer-2 背景，宿主遮罩与阴影 | [SettingsRoot.module.css](../../deepseek-harness/packages/client/ui-settings-general/src/client/SettingsRoot.module.css) |
| 侧栏项 | 40px 高、圆角 12、14/22；选中与悬停使用宿主语义色 | 同上 |
| 页面标题、标签页 | 标题 18px/600；标签页 13/20、间距 22、下划线 2px | [PluginsSettingsSection.module.css](../../deepseek-harness/packages/client/ui-settings-plugins/src/client/PluginsSettingsSection.module.css) |
| 表单字段 | 标签与控件间距 6；输入与选择框外高 36、圆角 8、水平内边距 12、layer-3 背景 | [fields.module.css](../../deepseek-harness/packages/client/ui-settings-plugins/src/client/fields.module.css) |
| 卡片 | 圆角 12、1px border-l2、layer-3 背景 | [PluginCard.module.css](../../deepseek-harness/packages/client/ui-settings-plugins/src/client/PluginCard.module.css) |
| 常规按钮 | 36px 高、圆角 18、14/22、水平内边距 14 | [Button.module.css](../../deepseek-harness/packages/client/ui-primitives/src/Button.module.css) |
| 紧凑按钮 | 28px 高、圆角 14、12/18、水平内边距 10 | 同上 |

宿主插件输入框声明 `height: 34px`，采用内容盒模型，加上上下边框后外高为 36px。插件统一使用 `border-box`，因此 `--wf-control-height` 为 36px，按实际外观对齐。多行输入按内容扩展；搜索框等紧凑控件可采用宿主对应场景的尺寸。

不同尺寸集中在 `.wf-root` 的 `--wf-font-*`、`--wf-control-*` 和 `--wf-card-radius` 中。组织图、项目组队和七模块表单共用这些基础规则，布局可按自身内容调整，保持可见焦点、禁用态与窄屏滚动。

## 复用边界

宿主 [`ui-primitives`](../../deepseek-harness/packages/client/ui-primitives/src/index.ts) 公开 Button、Input、Pill、Menu、Modal 和图标等组件；没有公开的通用 Select、Tabs 或 Toggle。插件遵循这些组件的样式契约，不导入宿主设置页的内部组件或内部 CSS Modules。

新增样式先核对宿主对应场景，使用已有语义 token；职责由插件拥有的控件组合留在插件内。宿主升级时同步核对上述来源与盒模型，避免仅复制声明数值而造成尺寸偏差。宿主完整规则见 [web-styling.md](../../deepseek-harness/docs/web-styling.md)。
