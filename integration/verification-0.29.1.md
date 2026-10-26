# 0.29.1 归档验收 / Archive acceptance

- 归档：`dsh-plugin-composable-workforce-0.29.1.tgz`
- 大小：1,188,451 bytes
- SHA-256：`6f5495e753ca1c3864e41d539ab1e2dc3ccd105c76a440c741822f40bd0da36c`
- 环境：官方 DSH `0.2.1-rc.3`，Node `24.21.0`，macOS arm64；Web 与官方签名 Desktop 使用同一插件包。
- 状态：带已有原生持久会话删除保留项的预发布候选。

本次仅简化显示：默认或显式返回本步骤时，顶部步骤条、详情竖向流程和模板流程图不画自回环、不占退回轨道、不添加自身退回提示。跨步骤退回的线、目标及无障碍说明保留；编辑器选项、导出、验收和实际执行规则不变。

## 本归档复测

| 检查 | 结果 |
| --- | --- |
| 类型检查、构建 | 通过 |
| 相关领域、详情、传输与布局测试 | 65通过，0失败，0跳过 |
| 详情组件浏览器检查 | 16通过；中英、明暗及320/768/1024/1440宽度；无页面或控制台错误 |
| 官方 Web 实包安装、使用、卸载、重装和清理 | 15通过；27,607个官方程序文件前后哈希一致 |
| 官方原生对话工作流实包检查 | 29通过；跨步骤回退及原验收执行仍通过，无页面错误 |
| 组织、知识、流程图及持久性实包检查 | 9通过，包含自返工提示隐藏与跨步骤提示保留 |
| 实际 Desktop 与 Web | 两端已安装0.29.1；Desktop第11步不再自回环，跨步骤6/7/9→5与10→8保留 |
| 数据与 Desktop 程序完整性 | 两端插件状态逐字节相同，权威知识文件哈希相同；Desktop6,437个程序文件哈希相同 |

Desktop本次前后程序哈希：`c3695a48bca37b3b5f8b754bdb7a907c7046e7f8c76aeab346df0247338f1b7b`。Web宿主前后哈希：`4320efc9d117186946ef38cbf4078d44d4472de8f9ec42fc107db0b5923c64ac`。

16项详情测试是带受控传输与Wiki握手夹具的组件测试，其余已标注实包的检查使用干净官方宿主与独立临时profile。实际本地profile只做官方安装与界面核验，没有运行业务任务或数据迁移。公开脱敏明细见发布附件 `verification-0.29.1.json`。

0.29.0的723项全量测试记录仍作为历史基础验收，本次不冒称重跑该全量测试。原生会话无官方删除接口的既有保留项不变；真实供应商质量、生产部署、Windows和其他架构未验收。安装/卸载和兼容范围见[README](../README.md)。

## English

The exact archive hides explicit/default self-return loops and special hints across the native header, details timeline and template diagram. Cross-step return routes remain visible. Configuration, execution, review and stored workflow definitions are unchanged.

Verification:65related tests,16component browser checks,15official archive lifecycle checks,29native archive UI checks and9feature/persistence checks passed. Actual macOS Desktop and Web use this archive; plugin state bytes and authoritative knowledge files are unchanged, as are the Desktop program files. The full723test result belongs to the0.29.0historical baseline and was not rerun for this UI patch. Existing upstream session-cleanup and platform/provider validation limits remain documented.
