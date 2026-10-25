# 0.23.0 圆形知识图谱与右侧关系阅读验收

日期：2026-10-25。版本：0.23.0。

**最终归档、源码 669/669、构建、独立组件专项、正式员工 78/78、语言 9/9、官方环境生命周期 14/14，以及用户本地安装与数据保留验收均已通过。** 下述记录按证据范围分别说明结果。旧版本、旧哈希或源码环境的检查不得代替本轮最终归档验证。

## 归档与验证状态

| 项目 | 当前状态 |
| --- | --- |
| 最终插件包 | [dsh-plugin-composable-workforce-0.23.0.tgz](../artifacts/dsh-plugin-composable-workforce-0.23.0.tgz) |
| 最终 SHA-256 | `50c2211897f0f714d7e8018f0bc105a45043286d19805511bc300d38806316f3`；生命周期执行前独立核对一致 |
| 大小及包内文件审核 | 1,041,763 字节；356/356 文件逐字节核对，禁止文件清单为空；[归档审核](../artifacts/wiki-circle-validation/archive.json) |
| 源码测试与构建 | 669/669，构建 exit 0；[全量测试](../artifacts/wiki-circle-validation/full-tests.log)、[构建日志](../artifacts/wiki-circle-validation/build.log) |
| 源码组件专项 | Sigma 与 SVG 备用画布均通过圆形初始布局、强拖动与正文开关／相机适配回归；[专项报告](../artifacts/wiki-circle-validation/component-regression/report.json) |
| 官方归档员工、关系阅读及语言回归 | 员工 78/78、语言 9/9；[正式员工报告](../artifacts/wiki-circle-validation/employee/employee-settings-result.json)、[归档绑定摘要](../artifacts/wiki-circle-validation/employee-validation-summary.json) |
| 官方归档安装、卸载、重装与完全清理 | 最终归档 14/14；[生命周期报告](../artifacts/lifecycle-0.23.0/report.json) |
| 生命周期执行日志与摘要 | [执行日志](../artifacts/wiki-circle-validation/lifecycle.log)、[哈希与清理摘要](../artifacts/wiki-circle-validation/lifecycle-summary.json) |
| 用户本地安装与数据保留 | 最终哈希对应安装及保留记录均通过；[安装记录](../artifacts/wiki-circle-validation/live/installation.json)、[数据保留记录](../artifacts/wiki-circle-validation/live/data-preservation.json) |

交付边界遵循 [ADR-001](../docs/decisions/001-official-plugin-boundary.md)、[安装与卸载说明](README.md) 和 [第三方许可说明](THIRD_PARTY_NOTICES.md)。报告必须绑定同一最终归档 SHA-256。

## 本轮界面与语义范围

本轮将知识节点的初始显示调整为圆形布局，保留一张整体语义画布。布局只决定显示坐标，不增加概念、实体或关系，不把连通分量和知识分组画成独立矩形框，也不为互不相连的知识制造桥接边。现有相机、缩放、拖动、真实一跳高亮及逐层关联探索沿用原有边界；初始布局几何与实际浏览行为分别验证。

图中左上角原 `.wiki-focus-relations` 浮框及专属样式已从实现中移除。主图沿真实边显示的语义关系标签保留。关系阅读统一进入右侧 `.wiki-semantic-links`，列表仅取所选根概念／实体的真实直接关系，选择边时显示该边已有的关系；不会把已展开探索集合中的所有关系拼成另一份噪声列表。

概念阅读先显示名称和定义／正文，再显示关系，之后是相关文章。关系分组可整体折叠；概念阅读默认展开，查看关联文章或原始资料时保留根关系上下文并默认折叠。每条关系的原生 disclosure 标题显示完整“源概念 → 关系谓词 → 目标概念”，展开后保留明确／推断标识、摘要、文章和精确来源引用。方向、谓词、依据类型与原始证据不因布局或列表迁移改变。

读取关系证据关联的文章时，根节点自身条目与根节点真实关系的条目共同参与合法上下文判断；打开相关文章或资料不会换成无关根或清空既有探索。点击真实边仍可阅读其关系证据。所有 disclosure 继续使用原生 `details/summary`，支持键盘操作；固定文案随 DSH 中文／English 更新，用户名称、正文、谓词与证据保持原文。

## 官方扩展、共享程序与只读边界

继续复用一套包级 `third_party/llm-wiki/` 网页和编译引擎，各员工、团队使用各自隔离的知识空间与快照，不复制整套 Wiki 程序。运行时共享引擎与空间隔离沿既有机制处理，详见 [共享 Wiki 接入规格](../docs/architecture/shared-llm-wiki.md)。

本轮变更限定在插件自有显示层与布局。没有修改 Harness 源码、程序构建物、内置插件、宿主依赖或原生组件，也未增加宿主私有接口。沙箱继续只通过既有授权父消息接收视图和请求只读资料。布局、选择、展开、正文及关系阅读不新增模型调用、不重编知识、不持久写入；最终归档的正式浏览器报告确认模型调用为零，已保存知识与业务状态不变。

隔离测试不操作用户 `3081` 服务、生产知识或项目对话。生命周期验证只使用完整官方发行版、独立临时 profile、随机端口和隔离夹具；本轮不创建工作树。通过隔离验收后的实际本地更新与只读界面核对在最后一节单独记录。

## 源码及组件验证

本轮完整源码测试共 669 项，全部通过，无失败、跳过或取消；构建完成插件 server、client 与共享 Wiki 产物。源码组件专项使用同一组七节点、五条真实边、两个真实连通分量，在 Sigma 与强制 SVG 备用画布分别记录初始世界坐标。七个节点距离共同中心的半径均为 100，相邻角间隔均约为 `2π/7`；这验证共同圆环，而不是由独立分量各自缩放形成的多个小图。两种渲染器的左侧关系浮框数量均为零。

强拖动将节点移至初始布局包络之外，再打开／关闭正文和点击适配。两种渲染器均保留已拖动的世界坐标，所有目标节点适配到可视画布范围内，无浏览器错误。此专项是源码级组件验证；正式归档员工／语言回归按下节独立报告记录，不混用结果。

## 正式归档界面与语言验证

最终归档在完整官方安装与独立临时 profile 中通过员工回归 78/78、语言子检查 9/9。报告 SHA-256 为 `c7c58e2925eea67084ea82a2d76f6d749455a6cf606b5ba1c98ee9491cbeb352`，已与原报告字节独立核对，摘要绑定的安装包哈希与本记录一致。浏览器使用独立 Chromium Headless Shell `145.0.7632.6`；原 74 项检查保留，新增四项覆盖本轮圆形与关系阅读，不变更既有夹具。

正式图谱初始四节点落在同一半径 100 圆环；九节点真实链与孤立背景按容量落在两层同心圆，内层三个、外层六个节点，所有实际节点与关系保留。图中左侧关系浮框数量为零。右侧 summary 原文为“模块划分 → 依据 → 职责边界”，证据默认折叠；键盘 Enter 和 Space 可操作，展开后保留第 4 行的精确来源引用。阅读相关文章及来源时保留所选根、关系列表和探索；关系专属条目关联文章也保持上下文，探索扩大后列表仍只展示根的一跳真实关系。

中英切换覆盖新的关系分组、完整三元组和证据阅读，用户概念名、谓词及正文保持原文，探索与阅读状态不丢失。浏览探索期间模型调用为零，已保存知识与业务状态保持一致。三个隔离知识空间仍共用一个 Wiki 引擎，测试结束后引擎停止、临时 profile 删除，临时路径对应进程数为零；官方入口与 manifest 的前后摘要一致。完整宿主目录保持不变的证据另由生命周期验证提供。

正式截图：[关系与精确证据](../artifacts/wiki-circle-validation/employee/employee-settings-relation-evidence.png)、[英文探索阅读](../artifacts/wiki-circle-validation/employee/locale-library/knowledge-exploration-english.png)、[深色知识图谱](../artifacts/wiki-circle-validation/employee/employee-settings-knowledge-dark.png)。

## 最终生命周期验证

执行前独立核对冻结归档 SHA-256 和 1,041,763 字节大小一致，再以完整官方 manifest 运行：

```sh
DSH_INSTALLATION_MANIFEST="$PWD/.local/official-validation-complete/node_modules/@deepseek-ai/dsh/package.json" \
WORKFORCE_LIFECYCLE_UI=0 \
WORKFORCE_LIFECYCLE_REPORT_DIR="$PWD/artifacts/lifecycle-0.23.0" \
node tests/plugin-lifecycle.mjs artifacts/dsh-plugin-composable-workforce-0.23.0.tgz
```

最终归档在官方 DSH `0.2.1-alpha.2` 的独立临时 profile 完成 14/14 项验收，报告中的 `tarballSha256` 与上方最终归档一致。范围包括官方安装、精确运行时 peers、归档内共享 Wiki 与许可／对应源码、核心插件功能、普通卸载、卸载后的宿主原生能力、保留数据重装及完整 purge。普通卸载保留数据，重装后员工／团队／记忆、工作流快照、任务、交付版本与验收历史保持一致，无重复实例或重放任务；purge 清除本插件专属状态和配置，同时保留隔离夹具中的用户成果与共享凭据。

39 项运行时 peer 均核对精确版本并解析到独立官方实体安装范围。官方安装及依赖共 28,779 个程序文件，前后 SHA-256 摘要同为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`；插件生命周期没有修改宿主程序文件。

脚本正常退出后，另外核对临时 profile 根目录已删除、随机端口 `64305` 拒绝连接，任务临时目录对应进程数量为零。[生命周期摘要](../artifacts/wiki-circle-validation/lifecycle-summary.json) 记录归档绑定、14 项结果、peer 数量、宿主摘要及清理结果。该流程未访问用户 `3081` 服务，未发送外部模型请求。

## 用户本地安装、数据保留与实际界面

本地环境通过官方机制更新为 0.23.0，安装记录绑定归档 SHA-256 `50c2211897f0f714d7e8018f0bc105a45043286d19805511bc300d38806316f3`。已安装 `lib/index.js`、`lib/client.js` 和 `lib/llm-wiki/web.html` 三个构建物与最终包逐字节一致。

39 项 peer 的精确版本和安装路径通过官方公开 `createRuntimeResolution` 与 `PluginPackages.packageOf`，在独立验证进程中以当前已安装 profile 和完整官方安装为输入做只读解析复现；结果全部为 `installation` 作用域，物理路径位于完整官方安装。该方法使用与官方启动相同的作用域规则，**不是对运行服务模块内存的内省**，也不把未安装官方运行时拦截器的裸 `createRequire(pluginPath)` 祖先查找当作实际运行时解析。解析复现没有启动第二个 profile，结束后释放验证进程自身的服务；profile 文件前后保持不变。没有修改宿主、仓库祖先依赖或用户配置来迎合验证结果。

更新前后的插件状态字节与 API 深比较相同，revision 仍为 115；状态文件 SHA-256 为 `61e3093f180a5cc823ddb08b35abc24ae26ce11d328e9f6c9b8cf4848b966648`。461 个知识文件的哈希、profile 配置和两个旧项目对话的工作流视图均未改变。数据保留报告记录 `mutatingLiveRequests: 0`，没有为截图或核对进行验收、推进、改选工作流、取消或重放任务。

实际界面中，技术负责人／架构师的认知记忆仍为 41 个概念、48 条语义关系；全图使用圆形布局，原左上关系列表不再遮挡画布。选择“架构决策记录”后，概念名称与定义在前，右侧统一展示九条根相关语义关系；展开已有关系可读完整三元组、原文明确标识与精确第 7 行来源证据，图中仍保留真实关系标签。该核对仅进行选择和阅读，没有改写知识。

实际界面截图：[圆形全图](../artifacts/wiki-circle-validation/live/overview.png)、[概念正文与右侧关系证据](../artifacts/wiki-circle-validation/live/after.png)。安装、状态保留与界面证据分别记录，不以截图代替归档或数据完整性验证。
