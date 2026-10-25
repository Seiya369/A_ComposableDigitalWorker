# 跟随 DSH 中英语言设置验收

日期：2026-10-25。版本：0.20.0。

## 最终交付物

- 归档：`artifacts/dsh-plugin-composable-workforce-0.20.0.tgz`
- SHA-256：`01171401aa7ee7dcfd163b078b86e7dcc09ccd455a703c85dfb3ff287b0be32a`
- 大小：1,028,905 字节；353 个文件，全部与最终源码或构建物逐字节核对。
- 包内没有宿主补丁、宿主构建物、node_modules、用户数据、凭据、测试夹具或本机路径依赖。
- 安装、普通卸载、保留数据重装、完全清理、许可及更新说明随包提供，见 `integration/README.md`、`LICENSES.md`、`integration/THIRD_PARTY_NOTICES.md`、`CHANGELOG.md`。

机器记录：`artifacts/i18n-validation/final/verification.json`；清单及校验：同目录 `archive.json`、`package-files.json` 与归档旁 `.sha256`。

## 行为与官方接入

插件所有固定界面文案跟随 DSH 的中文 / English 设置，不增加语言开关、独立偏好、本地存储或设置写入。覆盖三个资源库、员工四个配置模块、导入导出、能力选择器、团队组织、流程编辑、原生对话工作流、交付验收、知识分类、Wiki 图谱及阅读器、状态、提示、确认框与无障碍名称。主词典 611 条，独立 Wiki 词典 78 条。

通过已声明的官方 `@deepseek-ai/dsh-client-locale/client` 使用 `register`、`bind`、`getSnapshot` 和 `subscribe`。兼容官方 DSH 0.2.1-alpha.2、Cordis 4.0.5、Loader 1.0.6。39 个运行 peer 均核验精确版本及物理安装范围。接口依据、数据边界和清理方式见 `docs/architecture/host-locale.md`。

语言更新只重渲染组件；不重新挂载编辑器、不刷新页面、不更换流程/资料版本，也不触发模型调用。未保存表单、验收备注、查看步骤、图谱搜索、相机与阅读状态保留。知识 iframe 沿用原安全绑定消息，仅增加 `zh/en` 白名单语言；旧父消息缺省中文，非法语言消息拒绝。

员工、团队、工作流与步骤名称、岗位正文、专业资料、知识概念、文章及模型输出保持原文。固定错误在显示时翻译；仅明确的后端错误模板允许参数反匹配，未知外部错误保持原始诊断，避免被普通 UI 模板部分改写。英文长分类标题在原卡片高度内省略，悬停与无障碍名称保留全称；按钮不被挤出卡片，样式不依赖中文 aria 值。

词典通过 Cordis effect 注册与注销；部分注册失败会回滚，重复注销安全。React 订阅、iframe 监听和其他资源随原插件作用域清理，不写入或移除 DSH 原生语言偏好。没有修改宿主源文件或构建物。

## 验证与证据

- 全量源码测试 637/637 通过；之后错误存储/反匹配边界修正由最终语言与 @ 调用专项 11/11 覆盖，最终卡片布局与 Wiki 单数文案修正后知识/语言专项 34/34 通过。最终构建与声明类型检查通过。
- 最终同一归档在独立官方 profile 的原生工作流浏览器验证 20/20；其中语言子检查 3 项，通过原生 Settings / General / Language 菜单双向切换，验证选择器、步骤、详情、未提交验收备注及查看步骤保留，业务状态与模型请求数不变，浏览器未捕获错误为空。
- 最终同一归档在独立官方 profile 的员工设置完整回归 67/67，并额外验证资源库、员工、能力、团队、流程和认知 Wiki 的英文显示及中文原文保留。完整语言与宽窄屏检查清单见 `employee/locale-library-report.json` 及 `employee/employee-settings-result.json`，均位于 `artifacts/i18n-validation/final/`。
- 独立 Wiki 消息协议浏览器检查 5/5、英文渲染检查 5/5、既有知识/图谱专项 32/32 通过：验证旧消息默认中文、实时切换保留选择与来源请求、非法语言拒绝及无浏览器异常。证据位于 `final/wiki-protocol/`。
- 最终同一归档在干净官方发行版及独立临时 profile 完成安装、使用、普通卸载、宿主原生功能、保留数据重装及完全清理共 14 项检查。官方安装及依赖 28,779 个文件前后摘要均为 `91901bb3785607e69e3c3277c10e9eb81dc74f71b1e6ac0a51e7bb0da0f2b967`；报告 `artifacts/lifecycle-0.20.0-final/report.json` 绑定本归档哈希。

正式浏览器使用与项目 Playwright 匹配的独立 Chromium Headless Shell；仅测试环境开启软件 WebGL，以运行真实 Sigma 交互。正式进程自然退出并清除各自临时 profile，未操作用户 Chrome/Updater。此前系统 Chrome 继承 stdout 的退出诊断和布局修正前的结果仅保留在 debug 目录，不作为最终包验收。模型相关回归使用测试专用公开离线 LlmAdapter，不使用用户模型凭据。

独立复审确认官方语言边界、稳定挂载、字段/原文保护、iframe 状态及卸载完整；修正了提交成功但后续刷新失败时存入已翻译成品提示的问题，并收窄错误模板范围。本次没有创建工作树。

## 本地安装及数据保护

通过官方 CLI 更新 3081 本地 profile，已安装 server、client 和 Wiki 页面与最终归档构建字节一致；服务健康。用户原有完整插件状态保持 revision 97，工作单、项目默认、步骤及覆盖均未改变；461 份知识文件、用户 profile 的 cordis 配置逐文件哈希全部保持。

没有改动用户 DSH 语言设置，没有发送真实测试消息，没有启动、验收、取消或重放原有任务。中英设置切换测试全部在独立临时 profile 中完成。实际页面确认仍跟随用户原来的中文设置，并返回原选中的“你的岗位与默认写入目录说明”。证据位于 `artifacts/i18n-validation/final/live/`。
